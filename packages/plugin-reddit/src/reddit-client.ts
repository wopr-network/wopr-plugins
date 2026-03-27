import type Snoowrap from "snoowrap";
import { logger } from "./logger.js";
import { RateLimiter } from "./rate-limiter.js";

export interface RedditPost {
  id: string;
  name: string;
  author: string;
  title: string;
  body: string;
  subreddit: string;
}

export interface RedditComment {
  id: string;
  name: string;
  author: string;
  body: string;
  subreddit: string;
  parentId: string;
  linkId: string;
}

export interface RedditMessage {
  id: string;
  name: string;
  author: string;
  subject: string;
  body: string;
  type: "mention" | "comment_reply" | "dm";
}

export class RedditClient {
  private readonly snoowrap: Snoowrap;
  private readonly rateLimiter = new RateLimiter(55, 60_000); // 55/min to stay under 60

  constructor(snoowrap: Snoowrap) {
    this.snoowrap = snoowrap;
  }

  async getNewPosts(subreddit: string, options: { limit?: number; before?: string } = {}): Promise<RedditPost[]> {
    await this.rateLimiter.waitForToken();
    const sub = this.snoowrap.getSubreddit(subreddit);
    const posts = await (sub as any).getNew({ limit: options.limit ?? 25, before: options.before });
    return (posts as any[]).map((p) => ({
      id: p.id,
      name: p.name,
      author: p.author?.name ?? "[deleted]",
      title: p.title,
      body: p.selftext ?? "",
      subreddit: p.subreddit?.display_name ?? subreddit,
    }));
  }

  async searchSubreddit(subreddit: string, query: string, options: { limit?: number } = {}): Promise<RedditPost[]> {
    await this.rateLimiter.waitForToken();
    const sub = this.snoowrap.getSubreddit(subreddit);
    const results = await (sub as any).search({ query, sort: "new", time: "hour", limit: options.limit ?? 25 });
    return (results as any[]).map((p) => ({
      id: p.id,
      name: p.name,
      author: p.author?.name ?? "[deleted]",
      title: p.title,
      body: p.selftext ?? "",
      subreddit: p.subreddit?.display_name ?? subreddit,
    }));
  }

  async getUnreadMessages(): Promise<RedditMessage[]> {
    await this.rateLimiter.waitForToken();
    const messages = await this.snoowrap.getUnreadMessages();
    return (messages as any[]).map((m) => {
      let type: "mention" | "comment_reply" | "dm" = "dm";
      if (m.was_comment && m.subject?.startsWith("username mention")) type = "mention";
      else if (m.was_comment) type = "comment_reply";
      return {
        id: m.id,
        name: m.name,
        author: m.author?.name ?? "[deleted]",
        subject: m.subject ?? "",
        body: m.body ?? "",
        type,
      };
    });
  }

  async markAsRead(names: string[]): Promise<void> {
    if (names.length === 0) return;
    await this.rateLimiter.waitForToken();
    await this.snoowrap.markMessagesAsRead(names as any);
  }

  async replyToComment(commentId: string, body: string): Promise<string> {
    await this.rateLimiter.waitForToken();
    const comment = this.snoowrap.getComment(commentId);
    const reply = await (comment as any).reply(body);
    return reply.name;
  }

  async replyToPost(postId: string, body: string): Promise<string> {
    await this.rateLimiter.waitForToken();
    const post = this.snoowrap.getSubmission(postId);
    const reply = await (post as any).reply(body);
    return reply.name;
  }

  async submitSelfPost(subreddit: string, title: string, body: string): Promise<string> {
    await this.rateLimiter.waitForToken();
    const result = await (this.snoowrap as any).submitSelfpost({
      subredditName: subreddit,
      title,
      text: body,
    });
    return (result as any).name;
  }

  async submitLink(subreddit: string, title: string, url: string): Promise<string> {
    await this.rateLimiter.waitForToken();
    const result = await (this.snoowrap as any).submitLink({
      subredditName: subreddit,
      title,
      url,
    });
    return (result as any).name;
  }

  async sendDirectMessage(to: string, subject: string, body: string): Promise<void> {
    await this.rateLimiter.waitForToken();
    logger.debug({ msg: "Sending DM", to, subject });
    await this.snoowrap.composeMessage({ to, subject, text: body });
  }
}
