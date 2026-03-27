import { beforeEach, describe, expect, it, vi } from "vitest";
import { TwitterClient } from "../src/twitter-client.js";

// Mock twitter-api-v2
vi.mock("twitter-api-v2", () => {
  const mockTweet = vi.fn().mockResolvedValue({ data: { id: "123456" } });
  const mockMe = vi.fn().mockResolvedValue({ data: { id: "me123", username: "testbot" } });
  const mockMentions = vi.fn().mockResolvedValue({ data: { data: [{ id: "m1", text: "hello @bot" }] } });
  const mockSearch = vi.fn().mockResolvedValue({ data: { data: [{ id: "s1", text: "keyword match" }] } });
  const mockTimeline = vi.fn().mockResolvedValue({ data: { data: [{ id: "t1", text: "my tweet" }] } });
  const mockSendDm = vi.fn().mockResolvedValue({});
  const mockUploadMedia = vi.fn().mockResolvedValue("media-id-1");

  class MockTwitterApi {
    v2 = {
      tweet: mockTweet,
      me: mockMe,
      userMentionTimeline: mockMentions,
      search: mockSearch,
      userTimeline: mockTimeline,
      sendDmToParticipant: mockSendDm,
    };
    v1 = {
      uploadMedia: mockUploadMedia,
    };
  }

  return {
    TwitterApi: MockTwitterApi,
  };
});

describe("TwitterClient", () => {
  let client: TwitterClient;

  beforeEach(() => {
    client = new TwitterClient({
      apiKey: "test-key",
      apiKeySecret: "test-secret",
      accessToken: "test-token",
      accessTokenSecret: "test-token-secret",
    });
  });

  it("tweets and returns tweet ID", async () => {
    const id = await client.tweet("Hello world");
    expect(id).toBe("123456");
  });

  it("gets mentions", async () => {
    const mentions = await client.getMentions();
    expect(mentions).toHaveLength(1);
    expect(mentions[0].text).toBe("hello @bot");
  });

  it("searches tweets", async () => {
    const results = await client.search("test query");
    expect(results).toHaveLength(1);
    expect(results[0].text).toBe("keyword match");
  });

  it("uploads media file and returns media ID", async () => {
    const mediaId = await client.uploadMedia("/tmp/test.jpg", "image/jpeg");
    expect(mediaId).toBe("media-id-1");
  });

  it("uploads media buffer and returns media ID", async () => {
    const buf = Buffer.alloc(100);
    const mediaId = await client.uploadMediaBuffer(buf, "image/png");
    expect(mediaId).toBe("media-id-1");
  });

  it("sends DM", async () => {
    await expect(client.sendDM("user123", "Hello there")).resolves.toBeUndefined();
  });

  it("gets timeline", async () => {
    const timeline = await client.getTimeline();
    expect(timeline).toHaveLength(1);
    expect(timeline[0].id).toBe("t1");
  });

  it("exposes raw TwitterApi instance", () => {
    expect(client.raw).toBeDefined();
  });
});
