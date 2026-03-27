import { beforeEach, describe, expect, it, vi } from "vitest";
import { RedditClient } from "../src/reddit-client.js";
import { createMockSnoowrap } from "../src/__test-utils__/mocks.js";

// Mock snoowrap module
vi.mock("snoowrap", () => {
  return { default: vi.fn() };
});

describe("RedditClient", () => {
  let client: RedditClient;
  let mockSnoowrap: ReturnType<typeof createMockSnoowrap>;

  beforeEach(() => {
    mockSnoowrap = createMockSnoowrap();
    client = new RedditClient(mockSnoowrap);
  });

  it("fetches new posts from a subreddit", async () => {
    const mockPosts = [
      {
        id: "abc",
        name: "t3_abc",
        author: { name: "user1" },
        title: "Test",
        selftext: "body",
        subreddit: { display_name: "test" },
      },
    ];
    mockSnoowrap._mockSubreddit.getNew.mockResolvedValue(mockPosts);

    const posts = await client.getNewPosts("test", { limit: 10 });
    expect(mockSnoowrap.getSubreddit).toHaveBeenCalledWith("test");
    expect(posts).toHaveLength(1);
    expect(posts[0].id).toBe("abc");
  });

  it("sends a DM", async () => {
    await client.sendDirectMessage("targetUser", "subject", "body text");
    expect(mockSnoowrap.composeMessage).toHaveBeenCalledWith({
      to: "targetUser",
      subject: "subject",
      text: "body text",
    });
  });

  it("replies to a comment", async () => {
    const mockReply = vi.fn().mockResolvedValue({ name: "t1_new" });
    mockSnoowrap.getComment.mockReturnValue({ reply: mockReply });

    await client.replyToComment("abc123", "my reply");
    expect(mockSnoowrap.getComment).toHaveBeenCalledWith("abc123");
    expect(mockReply).toHaveBeenCalledWith("my reply");
  });

  it("submits a self post", async () => {
    const result = await client.submitSelfPost("test", "Title", "Body");
    expect(mockSnoowrap.submitSelfpost).toHaveBeenCalledWith({
      subredditName: "test",
      title: "Title",
      text: "Body",
    });
    expect(result).toBe("t3_abc123");
  });
});
