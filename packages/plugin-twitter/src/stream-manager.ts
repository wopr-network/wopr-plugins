/**
 * Twitter Filtered Stream Manager.
 *
 * Connects to Twitter's v2 filtered stream endpoint.
 * Allows adding/removing rules for mentions and keyword matches.
 * Emits events through the WOPR event bus.
 */

import type { TweetStream, TweetV2SingleStreamResult } from "twitter-api-v2";
import { logger } from "./logger.js";
import type { TwitterClient } from "./twitter-client.js";

export class StreamManager {
  private stream: TweetStream | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private isShuttingDown = false;

  constructor(private client: TwitterClient) {}

  /** Add a stream rule (e.g., "@botname" or "keyword"). */
  async addRule(value: string, tag: string): Promise<void> {
    await this.client.raw.v2.updateStreamRules({
      add: [{ value, tag }],
    });
    logger.info({ msg: "Stream rule added", value, tag });
  }

  /** Remove stream rules by tag. */
  async removeRulesByTag(tag: string): Promise<void> {
    const rules = await this.client.raw.v2.streamRules();
    const toDelete = rules.data?.filter((r) => r.tag === tag).map((r) => r.id) ?? [];
    if (toDelete.length > 0) {
      await this.client.raw.v2.updateStreamRules({ delete: { ids: toDelete } });
      logger.info({ msg: "Stream rules removed", tag, count: toDelete.length });
    }
  }

  /** Connect to the filtered stream. Calls onTweet for each matched tweet. */
  async connect(onTweet: (tweet: TweetV2SingleStreamResult) => void): Promise<void> {
    this.isShuttingDown = false;
    try {
      this.stream = await this.client.raw.v2.searchStream({
        "tweet.fields": ["author_id", "conversation_id", "created_at", "in_reply_to_user_id"],
        "user.fields": ["username"],
        expansions: ["author_id"],
      });

      this.stream.autoReconnect = true;
      this.stream.autoReconnectRetries = 5;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      this.stream.on("data" as any, (data: TweetV2SingleStreamResult) => {
        onTweet(data);
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      this.stream.on("error" as any, (err: Error) => {
        logger.error({ msg: "Stream error", error: String(err) });
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      this.stream.on("reconnected" as any, () => {
        logger.info({ msg: "Stream reconnected" });
      });

      logger.info({ msg: "Twitter filtered stream connected" });
    } catch (err) {
      logger.error({ msg: "Failed to connect stream", error: String(err) });
      throw err;
    }
  }

  /** Disconnect the stream gracefully. */
  async disconnect(): Promise<void> {
    this.isShuttingDown = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.stream) {
      this.stream.close();
      this.stream = null;
    }
    logger.info({ msg: "Stream disconnected" });
  }

  /** Returns true if the manager is in shutdown state. */
  get shuttingDown(): boolean {
    return this.isShuttingDown;
  }
}
