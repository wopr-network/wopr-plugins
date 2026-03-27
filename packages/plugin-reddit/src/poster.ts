import { logger } from "./logger.js";
import type { RedditClient } from "./reddit-client.js";

/**
 * Outbound Reddit actions: reply, post, DM.
 * Parses Reddit "thing names" (t1_ = comment, t3_ = post, t4_ = message)
 * to route replies to the correct API endpoint.
 */
export class RedditPoster {
  private readonly client: RedditClient;

  constructor(client: RedditClient) {
    this.client = client;
  }

  /**
   * Reply to a Reddit thing by its full name (t1_xxx, t3_xxx, t4_xxx).
   */
  async reply(thingName: string, body: string): Promise<void> {
    const [prefix, id] = this.parseThingName(thingName);

    switch (prefix) {
      case "t1": // comment
        await this.client.replyToComment(id, body);
        break;
      case "t3": // post
        await this.client.replyToPost(id, body);
        break;
      case "t4": // message — Reddit does not support reply threading on direct messages
        throw new Error(`Cannot reply to direct message ${thingName}: use sendDM instead`);
      default:
        logger.error({ msg: "Unknown thing prefix", prefix, thingName });
    }
  }

  async post(subreddit: string, title: string, body: string): Promise<string> {
    return this.client.submitSelfPost(subreddit, title, body);
  }

  async postLink(subreddit: string, title: string, url: string): Promise<string> {
    return this.client.submitLink(subreddit, title, url);
  }

  async sendDM(to: string, subject: string, body: string): Promise<void> {
    return this.client.sendDirectMessage(to, subject, body);
  }

  private parseThingName(name: string): [string, string] {
    const idx = name.indexOf("_");
    if (idx === -1) return ["unknown", name];
    return [name.slice(0, idx), name.slice(idx + 1)];
  }
}
