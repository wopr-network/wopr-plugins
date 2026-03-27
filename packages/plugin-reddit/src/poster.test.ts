import { describe, expect, it, vi } from "vitest";
import { RedditPoster } from "./poster.js";
import type { RedditClient } from "./reddit-client.js";

function makeMockClient(): RedditClient {
  return {
    replyToComment: vi.fn().mockResolvedValue(undefined),
    replyToPost: vi.fn().mockResolvedValue(undefined),
    sendDirectMessage: vi.fn().mockResolvedValue(undefined),
    submitSelfPost: vi.fn().mockResolvedValue("t3_abc"),
    submitLink: vi.fn().mockResolvedValue("t3_def"),
    getInboxItems: vi.fn().mockResolvedValue([]),
    getSubredditNew: vi.fn().mockResolvedValue([]),
    markRead: vi.fn().mockResolvedValue(undefined),
  } as unknown as RedditClient;
}

describe("RedditPoster.reply", () => {
  it("throws when replying to a t4_ direct message", async () => {
    const client = makeMockClient();
    const poster = new RedditPoster(client);
    await expect(poster.reply("t4_abc123", "hello")).rejects.toThrow();
  });

  it("calls replyToComment for t1_ things", async () => {
    const client = makeMockClient();
    const poster = new RedditPoster(client);
    await poster.reply("t1_abc123", "hello");
    expect(client.replyToComment).toHaveBeenCalledWith("abc123", "hello");
  });

  it("calls replyToPost for t3_ things", async () => {
    const client = makeMockClient();
    const poster = new RedditPoster(client);
    await poster.reply("t3_abc123", "hello");
    expect(client.replyToPost).toHaveBeenCalledWith("abc123", "hello");
  });
});
