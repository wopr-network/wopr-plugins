import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { RateLimiter } from "../../src/rate-limiter.js";

describe("RateLimiter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows up to maxTokens messages immediately", () => {
    const limiter = new RateLimiter(20, 30_000);
    for (let i = 0; i < 20; i++) {
      expect(limiter.tryConsume()).toBe(true);
    }
  });

  it("rejects the 21st message when tokens exhausted", () => {
    const limiter = new RateLimiter(20, 30_000);
    for (let i = 0; i < 20; i++) {
      limiter.tryConsume();
    }
    expect(limiter.tryConsume()).toBe(false);
  });

  it("refills tokens after the interval", () => {
    const limiter = new RateLimiter(20, 30_000);
    for (let i = 0; i < 20; i++) {
      limiter.tryConsume();
    }
    expect(limiter.tryConsume()).toBe(false);

    vi.advanceTimersByTime(30_000);

    expect(limiter.tryConsume()).toBe(true);
  });

  it("setModeratorMode increases max to 100", () => {
    const limiter = new RateLimiter(20, 30_000);
    for (let i = 0; i < 20; i++) {
      limiter.tryConsume();
    }
    expect(limiter.tryConsume()).toBe(false);

    vi.advanceTimersByTime(30_000);
    limiter.setModeratorMode(true);

    // Refill happened, now can send 100
    for (let i = 0; i < 100; i++) {
      expect(limiter.tryConsume()).toBe(true);
    }
    expect(limiter.tryConsume()).toBe(false);
  });

  it("setModeratorMode(false) resets max to 20", () => {
    const limiter = new RateLimiter(100, 30_000);
    limiter.setModeratorMode(false);
    vi.advanceTimersByTime(30_000);
    for (let i = 0; i < 20; i++) {
      expect(limiter.tryConsume()).toBe(true);
    }
    expect(limiter.tryConsume()).toBe(false);
  });

  it("waitForToken resolves after refill when tokens exhausted", async () => {
    const limiter = new RateLimiter(1, 30_000);
    limiter.tryConsume();

    // Start waiting
    let resolved = false;
    const promise = limiter.waitForToken().then(() => {
      resolved = true;
    });

    expect(resolved).toBe(false);

    // Advance time so the refill fires
    vi.advanceTimersByTime(30_000);
    await promise;

    expect(resolved).toBe(true);
  });

  it("waitForToken resolves immediately when tokens are available", async () => {
    const limiter = new RateLimiter(5, 30_000);
    await expect(limiter.waitForToken()).resolves.toBeUndefined();
  });
});
