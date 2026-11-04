'use strict';

/** Sliding-window limiter, in memory (swap for Redis if you run several instances). */
class RateLimiter {
  constructor({ max = 20, windowMs = 60_000 } = {}) {
    this.max = max;
    this.windowMs = windowMs;
    this.hits = new Map();
  }

  /** @returns {{ok:boolean, retryAfterSec:number}} */
  check(key, now = Date.now()) {
    const recent = (this.hits.get(key) || []).filter((t) => now - t < this.windowMs);
    if (recent.length >= this.max) {
      this.hits.set(key, recent);
      return { ok: false, retryAfterSec: Math.ceil((this.windowMs - (now - recent[0])) / 1000) };
    }
    recent.push(now);
    this.hits.set(key, recent);
    return { ok: true, retryAfterSec: 0 };
  }
}

module.exports = RateLimiter;
