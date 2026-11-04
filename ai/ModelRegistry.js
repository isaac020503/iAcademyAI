'use strict';

/**
 * Models are configuration, not code.
 *   OPENAI_MODEL   default model
 *   OPENAI_MODELS  comma-separated list shown in the model picker
 */
class ModelRegistry {
  constructor(env = process.env) {
    this.defaultModel = (env.OPENAI_MODEL || 'gpt-5').trim();
    const list = (env.OPENAI_MODELS || '').split(',').map((s) => s.trim()).filter(Boolean);
    this.models = [...new Set([this.defaultModel, ...list])];
  }

  list() { return this.models.map((id) => ({ id, default: id === this.defaultModel })); }

  /** Returns a model id that is allowed by config; unknown requests fall back to the default. */
  resolve(requested) {
    return this.models.includes(requested) ? requested : this.defaultModel;
  }
}

module.exports = ModelRegistry;
