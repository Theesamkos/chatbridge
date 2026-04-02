/**
 * Sliding-window rate limiter (Rule 27, Phase 5).
 *
 * Applied limits (CLAUDE.md § 3 / § 11):
 *  - Chat SSE endpoint:    10 req / 60 s / user   (Rule 27)
 *  - plugin.updateState:  60 req / 60 s / session
 */

interface WindowEntry {
  count: number;
  windowStart: number;
}

export class RateLimiter {
  private readonly windows = new Map<string, WindowEntry>();

  /**
   * Check and increment the counter for a given key.
   * @param key      Unique identifier, e.g. "chat:<userId>"
   * @param limit    Maximum requests allowed per window
   * @param windowMs Window size in milliseconds
   */
  check(
    key: string,
    limit: number,
    windowMs: number,
  ): { allowed: boolean; remaining: number; resetAt: number } {
    const now   = Date.now();
    let   entry = this.windows.get(key);

    if (!entry || now - entry.windowStart >= windowMs) {
      entry = { count: 0, windowStart: now };
      this.windows.set(key, entry);
    }

    const resetAt = entry.windowStart + windowMs;

    if (entry.count >= limit) {
      return { allowed: false, remaining: 0, resetAt };
    }

    entry.count++;
    return { allowed: true, remaining: limit - entry.count, resetAt };
  }
}

export const rateLimiter = new RateLimiter();
