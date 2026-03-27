import { beforeEach, describe, expect, it, vi } from "vitest";
import { redditChannelProvider, setDefaultSubject, setRedditClient } from "./channel-provider.js";
import type { RedditClient } from "./reddit-client.js";

function makeMockClient(): RedditClient {
  return {
    submitSelfPost: vi.fn().mockResolvedValue("t3_abc"),
    sendDirectMessage: vi.fn().mockResolvedValue(undefined),
    replyToComment: vi.fn().mockResolvedValue(undefined),
    replyToPost: vi.fn().mockResolvedValue(undefined),
    submitLink: vi.fn().mockResolvedValue("t3_def"),
    getInboxItems: vi.fn().mockResolvedValue([]),
    getSubredditNew: vi.fn().mockResolvedValue([]),
    markRead: vi.fn().mockResolvedValue(undefined),
  } as unknown as RedditClient;
}

describe("redditChannelProvider.send", () => {
  beforeEach(() => {
    setDefaultSubject(undefined);
  });

  it("uses content-derived subject for DMs (not hardcoded)", async () => {
    const client = makeMockClient();
    setRedditClient(client);
    await redditChannelProvider.send("someuser", "Hello world this is a test message");
    expect(client.sendDirectMessage).toHaveBeenCalledWith(
      "someuser",
      expect.not.stringContaining("WOPR Message"),
      "Hello world this is a test message",
    );
  });

  it("uses configured defaultSubject when set", async () => {
    const client = makeMockClient();
    setRedditClient(client);
    setDefaultSubject("My Custom Subject");
    await redditChannelProvider.send("someuser", "Hello");
    expect(client.sendDirectMessage).toHaveBeenCalledWith("someuser", "My Custom Subject", "Hello");
  });

  it("uses content-derived subject for subreddit self-posts", async () => {
    const client = makeMockClient();
    setRedditClient(client);
    await redditChannelProvider.send("subreddit:programming", "Some post content");
    expect(client.submitSelfPost).toHaveBeenCalledWith(
      "programming",
      expect.not.stringContaining("WOPR Message"),
      "Some post content",
    );
  });
});
