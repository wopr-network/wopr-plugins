import { beforeEach, describe, expect, it, vi } from "vitest";
import { RateLimiter } from "../src/rate-limiter.js";

describe("RateLimiter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("allows requests under the limit", async () => {
    const limiter = new RateLimiter(60, 60_000); // 60 per minute
    const results: boolean[] = [];
    for (let i = 0; i < 60; i++) {
      results.push(limiter.tryAcquire());
    }
    expect(results.every(Boolean)).toBe(true);
  });

  it("rejects requests over the limit", () => {
    const limiter = new RateLimiter(2, 60_000);
    expect(limiter.tryAcquire()).toBe(true);
    expect(limiter.tryAcquire()).toBe(true);
    expect(limiter.tryAcquire()).toBe(false);
  });

  it("replenishes tokens after window elapses", () => {
    const limiter = new RateLimiter(1, 1_000);
    expect(limiter.tryAcquire()).toBe(true);
    expect(limiter.tryAcquire()).toBe(false);
    vi.advanceTimersByTime(1_001);
    expect(limiter.tryAcquire()).toBe(true);
  });

  it("waitForToken resolves after window", async () => {
    const limiter = new RateLimiter(1, 100);
    limiter.tryAcquire(); // exhaust
    const promise = limiter.waitForToken();
    vi.advanceTimersByTime(101);
    await promise; // should resolve
  });
});
