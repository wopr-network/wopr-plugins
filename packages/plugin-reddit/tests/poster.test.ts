import { beforeEach, describe, expect, it, vi } from "vitest";
import { RedditPoster } from "../src/poster.js";
import { createMockSnoowrap } from "../src/__test-utils__/mocks.js";
import { RedditClient } from "../src/reddit-client.js";

vi.mock("snoowrap", () => ({ default: vi.fn() }));

describe("RedditPoster", () => {
  let client: RedditClient;
  let poster: RedditPoster;
  let mockSnoowrap: ReturnType<typeof createMockSnoowrap>;

  beforeEach(() => {
    mockSnoowrap = createMockSnoowrap();
    client = new RedditClient(mockSnoowrap);
    poster = new RedditPoster(client);
  });

  it("replies to a comment thing", async () => {
    const mockReply = vi.fn().mockResolvedValue({ name: "t1_reply" });
    mockSnoowrap.getComment.mockReturnValue({ reply: mockReply });

    await poster.reply("t1_abc123", "response text");
    expect(mockSnoowrap.getComment).toHaveBeenCalledWith("abc123");
    expect(mockReply).toHaveBeenCalledWith("response text");
  });

  it("replies to a post thing", async () => {
    const mockReply = vi.fn().mockResolvedValue({ name: "t1_reply" });
    mockSnoowrap.getSubmission.mockReturnValue({ reply: mockReply });

    await poster.reply("t3_xyz789", "response text");
    expect(mockSnoowrap.getSubmission).toHaveBeenCalledWith("xyz789");
    expect(mockReply).toHaveBeenCalledWith("response text");
  });

  it("submits a self post", async () => {
    await poster.post("test", "Title", "Body");
    expect(mockSnoowrap.submitSelfpost).toHaveBeenCalledWith({
      subredditName: "test",
      title: "Title",
      text: "Body",
    });
  });
});
