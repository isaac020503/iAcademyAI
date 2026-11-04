'use strict';
const fs = require('fs');
const path = require('path');

/**
 * Tracks token usage per user per UTC day, persisted to data/usage.json.
 * Optional cost estimate: set OPENAI_PRICE_INPUT_PER_1M / OPENAI_PRICE_OUTPUT_PER_1M (USD).
 */
class UsageTracker {
  constructor({ filePath, dailyTokenLimit = Number(process.env.AI_DAILY_TOKEN_LIMIT) || 300_000, env = process.env } = {}) {
    this.filePath = filePath;
    this.dailyTokenLimit = dailyTokenLimit;
    this.priceIn = Number(env.OPENAI_PRICE_INPUT_PER_1M) || 0;
    this.priceOut = Number(env.OPENAI_PRICE_OUTPUT_PER_1M) || 0;
    this.data = {};
    try { this.data = JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch (_) { this.data = {}; }
  }

  static today() { return new Date().toISOString().slice(0, 10); }

  _entry(userId) {
    const day = UsageTracker.today();
    const u = (this.data[userId] = this.data[userId] || {});
    return (u[day] = u[day] || { requests: 0, inputTokens: 0, outputTokens: 0 });
  }

  record(userId, { inputTokens = 0, outputTokens = 0 } = {}) {
    const e = this._entry(userId);
    e.requests += 1;
    e.inputTokens += inputTokens;
    e.outputTokens += outputTokens;
    this._save();
  }

  summary(userId) {
    const e = this._entry(userId);
    const total = e.inputTokens + e.outputTokens;
    const cost = (e.inputTokens * this.priceIn + e.outputTokens * this.priceOut) / 1_000_000;
    return {
      ...e,
      totalTokens: total,
      dailyTokenLimit: this.dailyTokenLimit,
      estimatedCostUsd: this.priceIn || this.priceOut ? Number(cost.toFixed(4)) : null
    };
  }

  overLimit(userId) {
    const e = this._entry(userId);
    return e.inputTokens + e.outputTokens >= this.dailyTokenLimit;
  }

  _save() {
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2));
    } catch (_) { /* usage tracking must never break a request */ }
  }
}

module.exports = UsageTracker;
