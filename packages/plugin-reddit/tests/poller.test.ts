import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RedditPoller } from "../src/poller.js";
import { createMockSnoowrap } from "../src/__test-utils__/mocks.js";
import { RedditClient } from "../src/reddit-client.js";

vi.mock("snoowrap", () => ({ default: vi.fn() }));

describe("RedditPoller", () => {
  let mockSnoowrap: ReturnType<typeof createMockSnoowrap>;
  let client: RedditClient;
  let poller: RedditPoller;

  beforeEach(() => {
    vi.useFakeTimers();
    mockSnoowrap = createMockSnoowrap();
    client = new RedditClient(mockSnoowrap);
  });

  afterEach(() => {
    poller?.stop();
    vi.useRealTimers();
  });

  it("polls subreddits and emits new posts", async () => {
    const onEvent = vi.fn();
    poller = new RedditPoller(client, {
      subreddits: ["test"],
      keywords: [],
      pollIntervalMs: 5_000,
      monitorInbox: false,
      onEvent,
    });

    const mockPosts = [
      {
        id: "p1",
        name: "t3_p1",
        author: { name: "user1" },
        title: "Post",
        selftext: "body",
        subreddit: { display_name: "test" },
      },
    ];
    mockSnoowrap._mockSubreddit.getNew.mockResolvedValue(mockPosts);

    poller.start();
    await vi.advanceTimersByTimeAsync(5_001);

    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: "post", id: "p1", author: "user1" }),
    );
  });

  it("does not re-emit already-seen posts", async () => {
    const onEvent = vi.fn();
    poller = new RedditPoller(client, {
      subreddits: ["test"],
      keywords: [],
      pollIntervalMs: 5_000,
      monitorInbox: false,
      onEvent,
    });

    const mockPosts = [
      {
        id: "p1",
        name: "t3_p1",
        author: { name: "user1" },
        title: "Post",
        selftext: "body",
        subreddit: { display_name: "test" },
      },
    ];
    mockSnoowrap._mockSubreddit.getNew.mockResolvedValue(mockPosts);

    poller.start();
    await vi.advanceTimersByTimeAsync(5_001);
    await vi.advanceTimersByTimeAsync(5_001);

    // Should only emit once (dedup by ID)
    expect(onEvent).toHaveBeenCalledTimes(1);
  });

  it("stops polling on stop()", async () => {
    const onEvent = vi.fn();
    poller = new RedditPoller(client, {
      subreddits: ["test"],
      keywords: [],
      pollIntervalMs: 5_000,
      monitorInbox: false,
      onEvent,
    });

    poller.start();
    poller.stop();
    await vi.advanceTimersByTimeAsync(10_000);

    expect(onEvent).not.toHaveBeenCalled();
  });
});
