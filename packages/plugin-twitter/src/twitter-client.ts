/**
 * Twitter API v2 client wrapper.
 *
 * Wraps twitter-api-v2 with:
 * - Automatic rate limit tracking (429 → queue + exponential backoff)
 * - Retry logic (up to 3 attempts)
 * - Media upload helper
 */

import type { TweetV2 } from "twitter-api-v2";
import { TwitterApi } from "twitter-api-v2";
import { logger } from "./logger.js";
import type { RateLimitState, TwitterConfig } from "./types.js";

const MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 1000;

export class TwitterClient {
  private api: TwitterApi;
  private rateLimits: Map<string, RateLimitState> = new Map();

  constructor(config: TwitterConfig) {
    this.api = new TwitterApi({
      appKey: config.apiKey,
      appSecret: config.apiKeySecret,
      accessToken: config.accessToken,
      accessSecret: config.accessTokenSecret,
    });
  }

  /** Get the underlying TwitterApi instance (for streaming, advanced use) */
  get raw(): TwitterApi {
    return this.api;
  }

  /** Post a tweet. Returns tweet ID. */
  async tweet(text: string, options?: { replyToId?: string; quoteId?: string; mediaIds?: string[] }): Promise<string> {
    return this.withRetry("tweets", async () => {
      const params: Record<string, unknown> = { text };
      if (options?.replyToId) params.reply = { in_reply_to_tweet_id: options.replyToId };
      if (options?.quoteId) params.quote_tweet_id = options.quoteId;
      if (options?.mediaIds?.length) params.media = { media_ids: options.mediaIds };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await this.api.v2.tweet(params as any);
      return result.data.id;
    });
  }

  /** Send a DM to a user by their user ID. */
  async sendDM(recipientId: string, text: string): Promise<void> {
    return this.withRetry("dm", async () => {
      // Use v2 DM to participant — works with v2 OAuth 1.0a
      await this.api.v2.sendDmToParticipant(recipientId, { text });
    });
  }

  /** Get recent mentions for the authenticated user. */
  async getMentions(sinceId?: string): Promise<TweetV2[]> {
    return this.withRetry("mentions", async () => {
      const me = await this.api.v2.me();
      const mentions = await this.api.v2.userMentionTimeline(me.data.id, {
        ...(sinceId ? { since_id: sinceId } : {}),
        max_results: 100,
      });
      return mentions.data.data ?? [];
    });
  }

  /** Search recent tweets. */
  async search(query: string, maxResults = 10): Promise<TweetV2[]> {
    return this.withRetry("search", async () => {
      const result = await this.api.v2.search(query, { max_results: maxResults });
      return result.data.data ?? [];
    });
  }

  /** Upload media (image/video) from a file path. Returns media ID string. */
  async uploadMedia(filePath: string, mimeType?: string): Promise<string> {
    return this.withRetry("media", async () => {
      const mediaId = await this.api.v1.uploadMedia(filePath, { mimeType });
      return mediaId;
    });
  }

  /** Upload media from a Buffer. Returns media ID string. */
  async uploadMediaBuffer(buffer: Buffer, mimeType: string): Promise<string> {
    return this.withRetry("media", async () => {
      const mediaId = await this.api.v1.uploadMedia(buffer, { mimeType });
      return mediaId;
    });
  }

  /** Get the authenticated user's timeline. */
  async getTimeline(maxResults = 20): Promise<TweetV2[]> {
    return this.withRetry("timeline", async () => {
      const me = await this.api.v2.me();
      const timeline = await this.api.v2.userTimeline(me.data.id, { max_results: maxResults });
      return timeline.data.data ?? [];
    });
  }

  /**
   * Retry wrapper with rate limit awareness.
   * On 429: sleep until reset + jitter, then retry.
   * On other errors: exponential backoff up to MAX_RETRIES.
   */
  private async withRetry<T>(endpoint: string, fn: () => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      // Check if we already know we're rate limited
      const limit = this.rateLimits.get(endpoint);
      if (limit && limit.remaining <= 0 && Date.now() < limit.resetAt) {
        const waitMs = limit.resetAt - Date.now() + Math.random() * 1000;
        logger.warn({ msg: "Rate limited, waiting", endpoint, waitMs: Math.round(waitMs) });
        await sleep(waitMs);
      }

      try {
        return await fn();
      } catch (err: unknown) {
        const status =
          (err as Record<string, unknown>)?.code ??
          (err as Record<string, unknown>)?.statusCode ??
          (err as Record<string, unknown>)?.status;
        if (status === 429) {
          const rateLimitErr = err as Record<string, unknown>;
          const rateLimit = rateLimitErr?.rateLimit as Record<string, unknown> | undefined;
          const resetEpoch = rateLimit?.reset as number | undefined;
          const resetAt = resetEpoch ? resetEpoch * 1000 : Date.now() + 60_000;
          this.rateLimits.set(endpoint, { remaining: 0, resetAt });
          const waitMs = resetAt - Date.now() + Math.random() * 1000;
          logger.warn({ msg: "429 rate limit hit", endpoint, attempt, waitMs: Math.round(waitMs) });
          await sleep(waitMs);
          continue;
        }
        if (attempt < MAX_RETRIES - 1) {
          const backoff = BASE_BACKOFF_MS * 2 ** attempt + Math.random() * 500;
          logger.warn({ msg: "Twitter API error, retrying", endpoint, attempt, error: String(err) });
          await sleep(backoff);
          continue;
        }
        logger.error({ msg: "Twitter API error, exhausted retries", endpoint, error: String(err) });
        throw err;
      }
    }
    throw new Error(`withRetry: exhausted ${MAX_RETRIES} retries for ${endpoint}`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
