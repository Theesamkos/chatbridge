/**
 * Circuit breaker for plugin tool invocations (Rule 3, Phase 5).
 *
 * Thresholds (from CLAUDE.md § 11):
 *  - Trip after 3 failures within 5 minutes.
 *  - Reset after 15 minutes of open state.
 */

const WINDOW_MS  = 5  * 60 * 1_000; // 5 min
const RESET_MS   = 15 * 60 * 1_000; // 15 min
const THRESHOLD  = 3;

interface BreakerEntry {
  count: number;
  windowStart: number;
  active: boolean;
  resetAt: number;
}

export class CircuitBreaker {
  private readonly counters = new Map<string, BreakerEntry>();

  private key(pluginId: string, conversationId: string): string {
    return `${pluginId}:${conversationId}`;
  }

  /**
   * Record a failure for a plugin+conversation pair.
   * Returns true if the circuit breaker just activated.
   */
  recordFailure(pluginId: string, conversationId: string): boolean {
    const key  = this.key(pluginId, conversationId);
    const now  = Date.now();

    let entry = this.counters.get(key);
    if (!entry) {
      entry = { count: 0, windowStart: now, active: false, resetAt: 0 };
      this.counters.set(key, entry);
    }

    // Slide the window if it has expired
    if (now - entry.windowStart > WINDOW_MS) {
      entry.count       = 0;
      entry.windowStart = now;
      entry.active      = false;
    }

    // Already tripped — don't double-fire
    if (entry.active) return false;

    entry.count++;

    if (entry.count >= THRESHOLD) {
      entry.active  = true;
      entry.resetAt = now + RESET_MS;
      return true; // just activated
    }

    return false;
  }

  /**
   * Returns true if the breaker is currently open (blocking calls).
   * Auto-resets if the reset period has elapsed.
   */
  isActive(pluginId: string, conversationId: string): boolean {
    const key   = this.key(pluginId, conversationId);
    const entry = this.counters.get(key);
    if (!entry || !entry.active) return false;

    if (Date.now() >= entry.resetAt) {
      entry.active      = false;
      entry.count       = 0;
      entry.windowStart = Date.now();
      return false;
    }

    return true;
  }

  /** Manually clear a breaker (e.g. after admin investigation). */
  reset(pluginId: string, conversationId: string): void {
    this.counters.delete(this.key(pluginId, conversationId));
  }
}

export const circuitBreaker = new CircuitBreaker();
