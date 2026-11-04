'use strict';

/**
 * Base class every AI provider implements. The rest of the app only talks to
 * this interface, so OpenAI can be swapped for another vendor without touching
 * routes or the frontend.
 */
class AIProvider {
  get name() { return 'base'; }
  isConfigured() { return false; }

  /**
   * Stream a response.
   * @param {{model:string, instructions:string, messages:{role:string,content:string}[],
   *          maxOutputTokens?:number, signal?:AbortSignal}} request
   * @returns {AsyncGenerator<{type:'delta',text:string}|{type:'usage',usage:{inputTokens:number,outputTokens:number}}>}
   */
  // eslint-disable-next-line require-yield
  async *stream() { throw new Error('stream() not implemented'); }
}

class AINotConfiguredError extends Error {
  constructor(message) { super(message); this.name = 'AINotConfiguredError'; this.status = 503; }
}

module.exports = { AIProvider, AINotConfiguredError };
