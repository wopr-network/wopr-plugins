import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearNotificationParsers,
  sendNotification,
  setTwitterProviderClient,
  twitterChannelProvider,
} from "../src/channel-provider.js";

describe("twitterChannelProvider", () => {
  beforeEach(() => {
    // Clean up state between tests
    twitterChannelProvider.getCommands().forEach((cmd) => twitterChannelProvider.unregisterCommand(cmd.name));
    twitterChannelProvider.getMessageParsers().forEach((p) => twitterChannelProvider.removeMessageParser(p.id));
    setTwitterProviderClient(null);
  });

  it("has id 'twitter'", () => {
    expect(twitterChannelProvider.id).toBe("twitter");
  });

  it("registers and retrieves commands", () => {
    const cmd = { name: "test", description: "test cmd", handler: vi.fn() };
    twitterChannelProvider.registerCommand(cmd);
    expect(twitterChannelProvider.getCommands()).toContainEqual(cmd);
    twitterChannelProvider.unregisterCommand("test");
    expect(twitterChannelProvider.getCommands()).toHaveLength(0);
  });

  it("registers and retrieves message parsers", () => {
    const parser = { id: "p1", pattern: /test/, handler: vi.fn() };
    twitterChannelProvider.addMessageParser(parser);
    expect(twitterChannelProvider.getMessageParsers()).toContainEqual(parser);
    twitterChannelProvider.removeMessageParser("p1");
    expect(twitterChannelProvider.getMessageParsers()).toHaveLength(0);
  });

  it("returns bot username", () => {
    setTwitterProviderClient(null, "testbot");
    expect(twitterChannelProvider.getBotUsername()).toBe("testbot");
  });

  it("throws when sending without client", async () => {
    setTwitterProviderClient(null);
    await expect(twitterChannelProvider.send("tweet:123", "hello")).rejects.toThrow("Twitter client not initialized");
  });

  it("sends a tweet reply when channelId starts with tweet:", async () => {
    const mockTweet = vi.fn().mockResolvedValue("new-tweet-id");
    const mockClient = { tweet: mockTweet, sendDM: vi.fn() } as any;
    setTwitterProviderClient(mockClient);
    await twitterChannelProvider.send("tweet:original-id", "Reply text");
    expect(mockTweet).toHaveBeenCalledWith("Reply text", { replyToId: "original-id" });
  });

  it("sends a DM when channelId starts with dm:", async () => {
    const mockSendDM = vi.fn().mockResolvedValue(undefined);
    const mockClient = { tweet: vi.fn(), sendDM: mockSendDM } as any;
    setTwitterProviderClient(mockClient);
    await twitterChannelProvider.send("dm:user123", "DM text");
    expect(mockSendDM).toHaveBeenCalledWith("user123", "DM text");
  });

  it("posts new tweet for unrecognized channelId", async () => {
    const mockTweet = vi.fn().mockResolvedValue("new-tweet-id");
    const mockClient = { tweet: mockTweet, sendDM: vi.fn() } as any;
    setTwitterProviderClient(mockClient);
    await twitterChannelProvider.send("some-channel", "New tweet text");
    expect(mockTweet).toHaveBeenCalledWith("New tweet text");
  });

  it("truncates content over 280 chars", async () => {
    const mockTweet = vi.fn().mockResolvedValue("tweet-id");
    const mockClient = { tweet: mockTweet, sendDM: vi.fn() } as any;
    setTwitterProviderClient(mockClient);
    const longText = "a".repeat(300);
    await twitterChannelProvider.send("tweet:123", longText);
    const calledWith = mockTweet.mock.calls[0][0] as string;
    expect(calledWith.length).toBeLessThanOrEqual(280);
    expect(calledWith.endsWith("...")).toBe(true);
  });
});

describe("sendNotification", () => {
  const mockClient = {
    sendDM: vi.fn().mockResolvedValue(undefined),
    tweet: vi.fn().mockResolvedValue("tweet-id-123"),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    clearNotificationParsers();
    twitterChannelProvider.getMessageParsers().forEach((p) => twitterChannelProvider.removeMessageParser(p.id));
    setTwitterProviderClient(mockClient as any, "botuser", "owner-user-id-123");
  });

  it("should be a no-op for non-friend-request types", async () => {
    const callbacks = { onAccept: vi.fn(), onDeny: vi.fn() };
    await sendNotification("dm:owner-user-id-123", { type: "other", from: "someone" }, callbacks);
    expect(mockClient.sendDM).not.toHaveBeenCalled();
    expect(callbacks.onAccept).not.toHaveBeenCalled();
    expect(callbacks.onDeny).not.toHaveBeenCalled();
  });

  it("should send a DM to the owner for friend-request", async () => {
    const callbacks = { onAccept: vi.fn(), onDeny: vi.fn() };
    await sendNotification("dm:owner-user-id-123", { type: "friend-request", from: "alice" }, callbacks);
    expect(mockClient.sendDM).toHaveBeenCalledWith("owner-user-id-123", expect.stringContaining("alice"));
    expect(mockClient.sendDM).toHaveBeenCalledWith("owner-user-id-123", expect.stringContaining("ACCEPT"));
  });

  it("should register a one-shot message parser", async () => {
    const callbacks = { onAccept: vi.fn(), onDeny: vi.fn() };
    await sendNotification("dm:owner-user-id-123", { type: "friend-request", from: "alice" }, callbacks);
    const parsers = twitterChannelProvider.getMessageParsers();
    const notifParser = parsers.find((p) => p.id.startsWith("notif-friend-"));
    expect(notifParser).toBeDefined();
  });

  it("should fire onAccept when handler receives ACCEPT from owner", async () => {
    const callbacks = {
      onAccept: vi.fn().mockResolvedValue(undefined),
      onDeny: vi.fn().mockResolvedValue(undefined),
    };
    await sendNotification("dm:owner-user-id-123", { type: "friend-request", from: "alice" }, callbacks);
    const parsers = twitterChannelProvider.getMessageParsers();
    const notifParser = parsers.find((p) => p.id.startsWith("notif-friend-"));
    expect(notifParser).toBeDefined();
    await notifParser!.handler({
      channel: "dm:owner-user-id-123",
      channelType: "twitter",
      sender: "owner-user-id-123",
      content: "accept",
      reply: vi.fn(),
      getBotUsername: () => "botuser",
    });
    expect(callbacks.onAccept).toHaveBeenCalled();
    expect(callbacks.onDeny).not.toHaveBeenCalled();
    // Parser should be removed (one-shot)
    const remaining = twitterChannelProvider.getMessageParsers();
    expect(remaining.find((p) => p.id === notifParser!.id)).toBeUndefined();
  });

  it("should fire onDeny when handler receives DENY from owner", async () => {
    const callbacks = {
      onAccept: vi.fn().mockResolvedValue(undefined),
      onDeny: vi.fn().mockResolvedValue(undefined),
    };
    await sendNotification("dm:owner-user-id-123", { type: "friend-request", from: "alice" }, callbacks);
    const parsers = twitterChannelProvider.getMessageParsers();
    const notifParser = parsers.find((p) => p.id.startsWith("notif-friend-"));
    await notifParser!.handler({
      channel: "dm:owner-user-id-123",
      channelType: "twitter",
      sender: "owner-user-id-123",
      content: "DENY",
      reply: vi.fn(),
      getBotUsername: () => "botuser",
    });
    expect(callbacks.onDeny).toHaveBeenCalled();
    expect(callbacks.onAccept).not.toHaveBeenCalled();
  });

  it("should not fire callbacks for non-owner sender", async () => {
    const callbacks = {
      onAccept: vi.fn().mockResolvedValue(undefined),
      onDeny: vi.fn().mockResolvedValue(undefined),
    };
    await sendNotification("dm:owner-user-id-123", { type: "friend-request", from: "alice" }, callbacks);
    const parsers = twitterChannelProvider.getMessageParsers();
    const notifParser = parsers.find((p) => p.id.startsWith("notif-friend-"));
    await notifParser!.handler({
      channel: "dm:owner-user-id-123",
      channelType: "twitter",
      sender: "other-user",
      content: "ACCEPT",
      reply: vi.fn(),
      getBotUsername: () => "botuser",
    });
    expect(callbacks.onAccept).not.toHaveBeenCalled();
    expect(callbacks.onDeny).not.toHaveBeenCalled();
    // Parser should still be registered
    expect(twitterChannelProvider.getMessageParsers().find((p) => p.id === notifParser!.id)).toBeDefined();
  });

  it("should fall back to tweet only on 403 DM failure", async () => {
    const err403 = Object.assign(new Error("DM not authorized"), { status: 403 });
    mockClient.sendDM.mockRejectedValueOnce(err403);
    const callbacks = { onAccept: vi.fn(), onDeny: vi.fn() };
    await sendNotification("dm:owner-user-id-123", { type: "friend-request", from: "alice" }, callbacks);
    expect(mockClient.tweet).toHaveBeenCalledWith(expect.stringContaining("alice"), undefined);
  });

  it("should rethrow non-403 DM errors without falling back to tweet", async () => {
    mockClient.sendDM.mockRejectedValueOnce(new Error("DM API unavailable"));
    const callbacks = { onAccept: vi.fn(), onDeny: vi.fn() };
    await expect(
      sendNotification("dm:owner-user-id-123", { type: "friend-request", from: "alice" }, callbacks),
    ).rejects.toThrow("DM API unavailable");
    expect(mockClient.tweet).not.toHaveBeenCalled();
  });

  it("should throw if twitterClient is null", async () => {
    setTwitterProviderClient(null);
    const callbacks = { onAccept: vi.fn(), onDeny: vi.fn() };
    await expect(
      sendNotification("dm:owner-user-id-123", { type: "friend-request", from: "alice" }, callbacks),
    ).rejects.toThrow("Twitter client not initialized");
  });

  it("should clean up parser on timeout", async () => {
    vi.useFakeTimers();
    const callbacks = { onAccept: vi.fn(), onDeny: vi.fn() };
    await sendNotification("dm:owner-user-id-123", { type: "friend-request", from: "alice" }, callbacks);
    expect(twitterChannelProvider.getMessageParsers().find((p) => p.id.startsWith("notif-friend-"))).toBeDefined();
    vi.advanceTimersByTime(5 * 60 * 1000 + 1);
    expect(twitterChannelProvider.getMessageParsers().find((p) => p.id.startsWith("notif-friend-"))).toBeUndefined();
    vi.useRealTimers();
  });
});
