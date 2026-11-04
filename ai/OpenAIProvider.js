'use strict';
const { AIProvider, AINotConfiguredError } = require('./AIProvider');

/**
 * OpenAI provider built on the official SDK and the Responses API.
 * The API key only ever lives on the server (process.env.OPENAI_API_KEY).
 * `clientFactory` exists so tests can inject a fake client.
 */
class OpenAIProvider extends AIProvider {
  constructor({ apiKey = process.env.OPENAI_API_KEY, clientFactory } = {}) {
    super();
    this.apiKey = (apiKey || '').trim();
    this.clientFactory = clientFactory || ((key) => {
      const OpenAI = require('openai');
      return new OpenAI({ apiKey: key });
    });
    this._client = null;
  }

  get name() { return 'openai'; }
  isConfigured() { return Boolean(this.apiKey); }

  get client() {
    if (!this.isConfigured()) {
      throw new AINotConfiguredError('OPENAI_API_KEY is not set. Add it to your .env file and restart the server.');
    }
    if (!this._client) this._client = this.clientFactory(this.apiKey);
    return this._client;
  }

  async *stream({ model, instructions, messages, maxOutputTokens, signal }) {
    const events = await this.client.responses.create(
      {
        model,
        instructions,
        input: messages.map((m) => ({ role: m.role, content: m.content })),
        stream: true,
        store: false,
        ...(maxOutputTokens ? { max_output_tokens: maxOutputTokens } : {})
      },
      signal ? { signal } : undefined
    );

    for await (const event of events) {
      switch (event.type) {
        case 'response.output_text.delta':
          if (event.delta) yield { type: 'delta', text: event.delta };
          break;
        case 'response.completed': {
          const u = event.response && event.response.usage;
          if (u) yield { type: 'usage', usage: { inputTokens: u.input_tokens || 0, outputTokens: u.output_tokens || 0 } };
          break;
        }
        case 'response.incomplete':
          yield { type: 'notice', text: 'The response was cut off (output limit reached).' };
          break;
        case 'response.failed': {
          const err = event.response && event.response.error;
          throw new Error((err && err.message) || 'The model failed to produce a response.');
        }
        case 'error':
          throw new Error(event.message || 'OpenAI stream error.');
        default:
          break;
      }
    }
  }
}

module.exports = OpenAIProvider;
