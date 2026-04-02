import { describe, it, expect, beforeEach } from "vitest";
import { CircuitBreaker } from "./circuitBreaker";

describe("CircuitBreaker", () => {
  let cb: CircuitBreaker;

  beforeEach(() => {
    cb = new CircuitBreaker();
  });

  it("counter increments with each failure", () => {
    expect(cb.recordFailure("chess", "conv-1")).toBe(false);
    expect(cb.recordFailure("chess", "conv-1")).toBe(false);
    expect(cb.isActive("chess", "conv-1")).toBe(false);
  });

  it("activates after 3 failures within 5 minutes", () => {
    cb.recordFailure("chess", "conv-1");
    cb.recordFailure("chess", "conv-1");
    const activated = cb.recordFailure("chess", "conv-1");
    expect(activated).toBe(true);
    expect(cb.isActive("chess", "conv-1")).toBe(true);
  });

  it("does not double-fire activation on further failures", () => {
    cb.recordFailure("chess", "conv-1");
    cb.recordFailure("chess", "conv-1");
    cb.recordFailure("chess", "conv-1");
    const again = cb.recordFailure("chess", "conv-1");
    expect(again).toBe(false); // already active, no second fire
    expect(cb.isActive("chess", "conv-1")).toBe(true);
  });

  it("isActive returns false after the reset period", () => {
    // Force the resetAt into the past
    cb.recordFailure("chess", "conv-1");
    cb.recordFailure("chess", "conv-1");
    cb.recordFailure("chess", "conv-1");
    expect(cb.isActive("chess", "conv-1")).toBe(true);

    // Patch internal state to simulate the reset window elapsing
    const internal = (cb as unknown as { counters: Map<string, { resetAt: number }> }).counters;
    internal.get("chess:conv-1")!.resetAt = Date.now() - 1;

    expect(cb.isActive("chess", "conv-1")).toBe(false);
  });

  it("reset clears the counter and deactivates the breaker", () => {
    cb.recordFailure("chess", "conv-1");
    cb.recordFailure("chess", "conv-1");
    cb.recordFailure("chess", "conv-1");
    expect(cb.isActive("chess", "conv-1")).toBe(true);

    cb.reset("chess", "conv-1");

    expect(cb.isActive("chess", "conv-1")).toBe(false);
  });

  it("is keyed per plugin+conversation — does not bleed across sessions", () => {
    cb.recordFailure("chess", "conv-A");
    cb.recordFailure("chess", "conv-A");
    cb.recordFailure("chess", "conv-A");
    expect(cb.isActive("chess", "conv-A")).toBe(true);
    expect(cb.isActive("chess", "conv-B")).toBe(false);
  });
});
