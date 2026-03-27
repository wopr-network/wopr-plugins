/**
 * Token-bucket rate limiter for Reddit API (60 req/min for OAuth).
 */
export class RateLimiter {
  private tokens: number;
  private readonly maxTokens: number;
  private readonly windowMs: number;
  private lastRefill: number;

  constructor(maxTokens: number, windowMs: number) {
    this.maxTokens = maxTokens;
    this.windowMs = windowMs;
    this.tokens = maxTokens;
    this.lastRefill = Date.now();
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    if (elapsed >= this.windowMs) {
      this.tokens = this.maxTokens;
      this.lastRefill = now;
    }
  }

  tryAcquire(): boolean {
    this.refill();
    if (this.tokens > 0) {
      this.tokens--;
      return true;
    }
    return false;
  }

  async waitForToken(): Promise<void> {
    while (!this.tryAcquire()) {
      const elapsed = Date.now() - this.lastRefill;
      const waitMs = Math.max(0, this.windowMs - elapsed) + 1;
      await new Promise<void>((resolve) => setTimeout(resolve, waitMs));
    }
  }

  get remaining(): number {
    this.refill();
    return this.tokens;
  }
}
