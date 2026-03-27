import { logger } from "./logger.js";
import type { RedditClient } from "./reddit-client.js";
import type { RedditInboundEvent } from "./types.js";

export interface PollerOptions {
  subreddits: string[];
  keywords: string[];
  pollIntervalMs: number;
  monitorInbox: boolean;
  onEvent: (event: RedditInboundEvent) => void;
}

export class RedditPoller {
  private readonly client: RedditClient;
  private readonly options: PollerOptions;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly seenIds = new Set<string>();

  constructor(client: RedditClient, options: PollerOptions) {
    this.client = client;
    this.options = options;
  }

  start(): void {
    if (this.timer) return;
    logger.info({
      msg: "Reddit poller started",
      subreddits: this.options.subreddits,
      intervalMs: this.options.pollIntervalMs,
    });
    this.timer = setInterval(() => {
      this.poll().catch((err) => logger.error({ msg: "Poll cycle failed", error: String(err) }));
    }, this.options.pollIntervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      logger.info({ msg: "Reddit poller stopped" });
    }
  }

  private async poll(): Promise<void> {
    await Promise.all([this.pollSubreddits(), this.options.monitorInbox ? this.pollInbox() : Promise.resolve()]);
  }

  private async pollSubreddits(): Promise<void> {
    for (const subreddit of this.options.subreddits) {
      try {
        const posts = await this.client.getNewPosts(subreddit, { limit: 25 });
        for (const post of posts) {
          if (this.seenIds.has(post.id)) continue;
          this.seenIds.add(post.id);

          // Keyword filter: if keywords are set, only emit matching posts
          if (this.options.keywords.length > 0) {
            const text = `${post.title} ${post.body}`.toLowerCase();
            const matches = this.options.keywords.some((kw) => text.includes(kw));
            if (!matches) continue;
          }

          const event: RedditInboundEvent = {
            type: "post",
            id: post.id,
            author: post.author,
            body: `${post.title}\n\n${post.body}`.trim(),
            subreddit: post.subreddit,
            thingName: post.name,
          };
          this.options.onEvent(event);
        }
      } catch (err) {
        logger.error({ msg: "Failed to poll subreddit", subreddit, error: String(err) });
      }
    }
  }

  private async pollInbox(): Promise<void> {
    try {
      const messages = await this.client.getUnreadMessages();
      const toMark: string[] = [];
      for (const msg of messages) {
        if (this.seenIds.has(msg.id)) continue;
        this.seenIds.add(msg.id);
        toMark.push(msg.name);

        const event: RedditInboundEvent = {
          type: msg.type === "dm" ? "dm" : msg.type === "mention" ? "mention" : "comment",
          id: msg.id,
          author: msg.author,
          body: msg.body,
          thingName: msg.name,
        };
        this.options.onEvent(event);
      }
      if (toMark.length > 0) {
        await this.client.markAsRead(toMark);
      }
    } catch (err) {
      logger.error({ msg: "Failed to poll inbox", error: String(err) });
    }
  }
}
