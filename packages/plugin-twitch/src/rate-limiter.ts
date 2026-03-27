/**
 * Simple token bucket rate limiter for Twitch IRC.
 * Default: 20 messages per 30 seconds (regular user).
 * Moderators: 100 messages per 30 seconds.
 */
export class RateLimiter {
  private tokens: number;
  private lastRefill: number;

  constructor(
    private maxTokens: number = 20,
    private refillIntervalMs: number = 30_000,
  ) {
    this.tokens = maxTokens;
    this.lastRefill = Date.now();
  }

  /** Set the rate based on whether the bot is a moderator. */
  setModeratorMode(isMod: boolean): void {
    this.maxTokens = isMod ? 100 : 20;
  }

  /** Try to consume a token. Returns true if allowed, false if rate-limited. */
  tryConsume(): boolean {
    this.refill();
    if (this.tokens > 0) {
      this.tokens--;
      return true;
    }
    return false;
  }

  /** Wait until a token is available, then consume it. */
  async waitForToken(): Promise<void> {
    while (!this.tryConsume()) {
      const waitMs = this.refillIntervalMs - (Date.now() - this.lastRefill);
      await new Promise((resolve) => setTimeout(resolve, Math.max(waitMs, 100)));
    }
  }

  private refill(): void {
    const now = Date.now();
    if (now - this.lastRefill >= this.refillIntervalMs) {
      this.tokens = this.maxTokens;
      this.lastRefill = now;
    }
  }
}
