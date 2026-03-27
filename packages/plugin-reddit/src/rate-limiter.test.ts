import { describe, expect, it, vi } from "vitest";
import { RateLimiter } from "./rate-limiter.js";

describe("RateLimiter", () => {
  describe("tryAcquire", () => {
    it("should acquire up to maxTokens then reject", () => {
      const limiter = new RateLimiter(3, 1000);
      expect(limiter.tryAcquire()).toBe(true);
      expect(limiter.tryAcquire()).toBe(true);
      expect(limiter.tryAcquire()).toBe(true);
      expect(limiter.tryAcquire()).toBe(false);
    });

    it("should refill after window elapses", () => {
      vi.useFakeTimers();
      const limiter = new RateLimiter(2, 1000);
      expect(limiter.tryAcquire()).toBe(true);
      expect(limiter.tryAcquire()).toBe(true);
      expect(limiter.tryAcquire()).toBe(false);

      vi.advanceTimersByTime(1000);

      expect(limiter.tryAcquire()).toBe(true);
      expect(limiter.tryAcquire()).toBe(true);
      expect(limiter.tryAcquire()).toBe(false);
      vi.useRealTimers();
    });
  });

  describe("waitForToken", () => {
    it("should resolve immediately when tokens are available", async () => {
      const limiter = new RateLimiter(5, 1000);
      await limiter.waitForToken();
      expect(limiter.remaining).toBe(4);
    });

    it("should wait and then acquire when tokens are exhausted", async () => {
      vi.useFakeTimers();
      const limiter = new RateLimiter(1, 1000);
      // Exhaust the single token
      expect(limiter.tryAcquire()).toBe(true);

      const waitPromise = limiter.waitForToken();

      // Advance past the window so refill fires
      await vi.advanceTimersByTimeAsync(1001);

      await waitPromise;
      // Token was acquired by waitForToken, so remaining should be 0
      expect(limiter.remaining).toBe(0);
      vi.useRealTimers();
    });

    it("should never allow more than maxTokens through per window under concurrency", async () => {
      vi.useFakeTimers();
      const maxTokens = 3;
      const limiter = new RateLimiter(maxTokens, 1000);
      let acquired = 0;

      // Launch more concurrent waiters than tokens available
      const promises = Array.from({ length: 6 }, async () => {
        await limiter.waitForToken();
        acquired++;
      });

      // First 3 should resolve immediately (tokens available)
      await vi.advanceTimersByTimeAsync(0);
      expect(acquired).toBe(maxTokens);

      // Remaining 3 are waiting. Advance one window — should get 3 more.
      await vi.advanceTimersByTimeAsync(1001);
      await Promise.all(promises);
      expect(acquired).toBe(6);

      // Verify remaining is 0 (all tokens consumed in second window)
      expect(limiter.remaining).toBe(0);
      vi.useRealTimers();
    });
  });

  describe("remaining", () => {
    it("should report correct token count", () => {
      const limiter = new RateLimiter(5, 1000);
      expect(limiter.remaining).toBe(5);
      limiter.tryAcquire();
      expect(limiter.remaining).toBe(4);
    });
  });
});
