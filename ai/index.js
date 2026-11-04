'use strict';
const path = require('path');
const OpenAIProvider = require('./OpenAIProvider');
const ModelRegistry = require('./ModelRegistry');
const PromptManager = require('./PromptManager');
const UsageTracker = require('./UsageTracker');
const RateLimiter = require('./RateLimiter');
const { AINotConfiguredError } = require('./AIProvider');

const LIMITS = { maxMessages: 30, maxMessageChars: 8000, maxContextChars: 24000, maxTopicChars: 200, maxFocusChars: 600 };

class ValidationError extends Error {
  constructor(message) { super(message); this.name = 'ValidationError'; this.status = 400; }
}

/**
 * Central AI service: validation, limits, prompts, provider streaming, usage.
 * Routes call stream*() and forward the yielded events to the browser.
 */
class AIService {
  constructor({ provider, models, prompts, usage, limiter, dataDir }) {
    this.provider = provider || new OpenAIProvider();
    this.models = models || new ModelRegistry();
    this.prompts = prompts || new PromptManager();
    this.usage = usage || new UsageTracker({ filePath: path.join(dataDir || path.join(__dirname, '..', 'data'), 'usage.json') });
    this.limiter = limiter || new RateLimiter({ max: Number(process.env.AI_RATE_LIMIT_PER_MIN) || 20 });
  }

  status(userId) {
    return {
      configured: this.provider.isConfigured(),
      provider: this.provider.name,
      defaultModel: this.models.defaultModel,
      models: this.models.list(),
      modes: this.prompts.modes(),
      levels: this.prompts.levels(),
      depths: this.prompts.depths(),
      usage: this.usage.summary(userId)
    };
  }

  _guard(userId) {
    if (!this.provider.isConfigured()) {
      throw new AINotConfiguredError('The AI is not configured. Set OPENAI_API_KEY in .env (see .env.example) and restart the server.');
    }
    const rl = this.limiter.check(userId);
    if (!rl.ok) {
      const e = new Error(`Too many AI requests. Try again in ${rl.retryAfterSec}s.`);
      e.status = 429;
      throw e;
    }
    if (this.usage.overLimit(userId)) {
      const e = new Error('Daily AI token limit reached. It resets at 00:00 UTC.');
      e.status = 429;
      throw e;
    }
  }

  static cleanMessages(messages) {
    if (!Array.isArray(messages) || messages.length === 0) throw new ValidationError('messages must be a non-empty array.');
    if (messages.length > LIMITS.maxMessages) messages = messages.slice(-LIMITS.maxMessages);
    const clean = messages.map((m) => {
      if (!m || (m.role !== 'user' && m.role !== 'assistant') || typeof m.content !== 'string') {
        throw new ValidationError('Each message needs a role (user|assistant) and string content.');
      }
      if (m.content.length > LIMITS.maxMessageChars) throw new ValidationError(`A message is longer than ${LIMITS.maxMessageChars} characters.`);
      return { role: m.role, content: m.content };
    });
    if (clean[clean.length - 1].role !== 'user') throw new ValidationError('The last message must come from the user.');
    return clean;
  }

  async *_run(userId, request) {
    let usage = null;
    try {
      for await (const evt of this.provider.stream(request)) {
        if (evt.type === 'usage') usage = evt.usage;
        yield evt;
      }
    } finally {
      // Count whatever we know even if the client aborted mid-stream.
      this.usage.record(userId, usage || { inputTokens: 0, outputTokens: 0 });
    }
    yield { type: 'done', usage: this.usage.summary(userId) };
  }

  async *streamChat(userId, body, signal) {
    const messages = AIService.cleanMessages(body && body.messages);
    const mode = this.prompts.hasMode(body.mode) ? body.mode : 'tutor';
    const context = typeof body.context === 'string' ? body.context.slice(0, LIMITS.maxContextChars) : '';
    this._guard(userId);
    yield* this._run(userId, {
      model: this.models.resolve(body.model),
      instructions: this.prompts.chat(mode, context),
      messages,
      maxOutputTokens: 3000,
      signal
    });
  }

  async *streamLecture(userId, body, signal) {
    const topic = typeof body.topic === 'string' ? body.topic.trim() : '';
    if (topic.length < 2 || topic.length > LIMITS.maxTopicChars) throw new ValidationError(`Topic must be 2-${LIMITS.maxTopicChars} characters.`);
    const level = this.prompts.levels().includes(body.level) ? body.level : 'beginner';
    const depth = this.prompts.depths().includes(body.depth) ? body.depth : 'standard';
    const focus = typeof body.focus === 'string' ? body.focus.trim().slice(0, LIMITS.maxFocusChars) : '';
    this._guard(userId);
    const p = this.prompts.lecture({ topic, level, depth, focus });
    yield* this._run(userId, { model: this.models.resolve(body.model), ...p, signal });
  }

  /** Non-streaming helper (used by the legacy /api/coach endpoint). */
  async complete(userId, body) {
    let text = '';
    for await (const evt of this.streamChat(userId, body)) if (evt.type === 'delta') text += evt.text;
    return text.trim();
  }
}

module.exports = { AIService, ValidationError, AINotConfiguredError, LIMITS };
