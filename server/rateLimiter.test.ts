import { describe, it, expect, beforeEach } from "vitest";
import { RateLimiter } from "./rateLimiter";

describe("RateLimiter", () => {
  let rl: RateLimiter;

  beforeEach(() => {
    rl = new RateLimiter();
  });

  it("allows requests within the limit", () => {
    for (let i = 0; i < 5; i++) {
      const result = rl.check("chat:1", 10, 60_000);
      expect(result.allowed).toBe(true);
    }
    const result = rl.check("chat:1", 10, 60_000);
    expect(result.remaining).toBe(4);
  });

  it("blocks requests once the limit is exceeded", () => {
    for (let i = 0; i < 10; i++) {
      rl.check("chat:1", 10, 60_000);
    }
    const result = rl.check("chat:1", 10, 60_000);
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it("resets after the window expires", () => {
    for (let i = 0; i < 10; i++) {
      rl.check("chat:1", 10, 60_000);
    }
    expect(rl.check("chat:1", 10, 60_000).allowed).toBe(false);

    // Manually wind back the windowStart to simulate expiry
    const internal = (rl as unknown as { windows: Map<string, { windowStart: number }> }).windows;
    internal.get("chat:1")!.windowStart = Date.now() - 61_000;

    const result = rl.check("chat:1", 10, 60_000);
    expect(result.allowed).toBe(true);
  });

  it("tracks separate keys independently", () => {
    for (let i = 0; i < 10; i++) rl.check("chat:1", 10, 60_000);
    expect(rl.check("chat:1", 10, 60_000).allowed).toBe(false);
    expect(rl.check("chat:2", 10, 60_000).allowed).toBe(true);
  });

  it("returns a resetAt timestamp in the future", () => {
    const { resetAt } = rl.check("chat:1", 10, 60_000);
    expect(resetAt).toBeGreaterThan(Date.now());
  });
});
