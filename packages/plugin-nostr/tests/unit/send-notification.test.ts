import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("nostrChannelProvider.sendNotification", () => {
  let mockPublisher: {
    publishDM: ReturnType<typeof vi.fn>;
    publishReply: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    vi.useFakeTimers();
    mockPublisher = {
      publishDM: vi.fn().mockResolvedValue("event-id"),
      publishReply: vi.fn().mockResolvedValue("reply-id"),
    };
  });

  afterEach(async () => {
    vi.useRealTimers();
    const { nostrChannelProvider } = await import("../../src/channel-provider.js");
    for (const parser of nostrChannelProvider.getMessageParsers()) {
      nostrChannelProvider.removeMessageParser(parser.id);
    }
  });

  it("sends encrypted DM with friend request message", async () => {
    const { nostrChannelProvider, setPublisher } = await import("../../src/channel-provider.js");
    setPublisher(mockPublisher as never);

    await nostrChannelProvider.sendNotification!("dm:owner123pubkey", {
      type: "friend-request",
      from: "alice",
    });

    expect(mockPublisher.publishDM).toHaveBeenCalledWith(
      expect.stringContaining("alice"),
      "owner123pubkey",
    );
    expect(mockPublisher.publishDM).toHaveBeenCalledWith(
      expect.stringMatching(/ACCEPT|DENY/i),
      "owner123pubkey",
    );
  });

  it("registers one-shot message parser when callbacks provided", async () => {
    const { nostrChannelProvider, setPublisher } = await import("../../src/channel-provider.js");
    setPublisher(mockPublisher as never);

    const onAccept = vi.fn().mockResolvedValue(undefined);
    const onDeny = vi.fn().mockResolvedValue(undefined);

    await nostrChannelProvider.sendNotification!("dm:owner123pubkey", {
      type: "friend-request",
      from: "alice",
    }, { onAccept, onDeny });

    const parsers = nostrChannelProvider.getMessageParsers();
    expect(parsers.length).toBe(1);
    expect(parsers[0].id).toMatch(/^notif-friend-request-/);
  });

  it("parser fires onAccept and self-removes on ACCEPT reply", async () => {
    const { nostrChannelProvider, setPublisher } = await import("../../src/channel-provider.js");
    setPublisher(mockPublisher as never);

    const onAccept = vi.fn().mockResolvedValue(undefined);
    const onDeny = vi.fn().mockResolvedValue(undefined);

    await nostrChannelProvider.sendNotification!("dm:owner123pubkey", {
      type: "friend-request",
      from: "alice",
    }, { onAccept, onDeny });

    const parser = nostrChannelProvider.getMessageParsers()[0];
    await parser.handler({
      channel: "dm:owner123pubkey",
      channelType: "nostr",
      sender: "owner123pubkey",
      content: "ACCEPT",
      reply: vi.fn().mockResolvedValue(undefined),
      getBotUsername: () => "npub1bot",
    });

    expect(onAccept).toHaveBeenCalledOnce();
    expect(onDeny).not.toHaveBeenCalled();
    expect(nostrChannelProvider.getMessageParsers().length).toBe(0);
  });

  it("parser fires onDeny and self-removes on DENY reply", async () => {
    const { nostrChannelProvider, setPublisher } = await import("../../src/channel-provider.js");
    setPublisher(mockPublisher as never);

    const onAccept = vi.fn().mockResolvedValue(undefined);
    const onDeny = vi.fn().mockResolvedValue(undefined);

    await nostrChannelProvider.sendNotification!("dm:owner123pubkey", {
      type: "friend-request",
      from: "alice",
    }, { onAccept, onDeny });

    const parser = nostrChannelProvider.getMessageParsers()[0];
    await parser.handler({
      channel: "dm:owner123pubkey",
      channelType: "nostr",
      sender: "owner123pubkey",
      content: "  deny  ",
      reply: vi.fn().mockResolvedValue(undefined),
      getBotUsername: () => "npub1bot",
    });

    expect(onDeny).toHaveBeenCalledOnce();
    expect(onAccept).not.toHaveBeenCalled();
    expect(nostrChannelProvider.getMessageParsers().length).toBe(0);
  });

  it("parser ignores unrelated messages", async () => {
    const { nostrChannelProvider, setPublisher } = await import("../../src/channel-provider.js");
    setPublisher(mockPublisher as never);

    const onAccept = vi.fn().mockResolvedValue(undefined);

    await nostrChannelProvider.sendNotification!("dm:owner123pubkey", {
      type: "friend-request",
      from: "alice",
    }, { onAccept });

    const parser = nostrChannelProvider.getMessageParsers()[0];
    await parser.handler({
      channel: "dm:owner123pubkey",
      channelType: "nostr",
      sender: "owner123pubkey",
      content: "hello there",
      reply: vi.fn().mockResolvedValue(undefined),
      getBotUsername: () => "npub1bot",
    });

    expect(onAccept).not.toHaveBeenCalled();
    expect(nostrChannelProvider.getMessageParsers().length).toBe(1);
  });

  it("parser auto-removes after 5-minute timeout", async () => {
    const { nostrChannelProvider, setPublisher } = await import("../../src/channel-provider.js");
    setPublisher(mockPublisher as never);

    await nostrChannelProvider.sendNotification!("dm:owner123pubkey", {
      type: "friend-request",
      from: "alice",
    }, { onAccept: vi.fn().mockResolvedValue(undefined) });

    expect(nostrChannelProvider.getMessageParsers().length).toBe(1);

    vi.advanceTimersByTime(5 * 60 * 1000 + 1);

    expect(nostrChannelProvider.getMessageParsers().length).toBe(0);
  });

  it("throws when publisher not initialized", async () => {
    const { nostrChannelProvider, setPublisher } = await import("../../src/channel-provider.js");
    setPublisher(null);

    await expect(
      nostrChannelProvider.sendNotification!("dm:abc", { type: "friend-request" }),
    ).rejects.toThrow("Nostr publisher not initialized");
  });

  it("no-ops for non-dm channelId", async () => {
    const { nostrChannelProvider, setPublisher } = await import("../../src/channel-provider.js");
    setPublisher(mockPublisher as never);

    await nostrChannelProvider.sendNotification!("public:abc", {
      type: "friend-request",
      from: "alice",
    });

    expect(mockPublisher.publishDM).not.toHaveBeenCalled();
  });

  it("no-ops for unknown notification type", async () => {
    const { nostrChannelProvider, setPublisher } = await import("../../src/channel-provider.js");
    setPublisher(mockPublisher as never);

    await nostrChannelProvider.sendNotification!("dm:owner123", {
      type: "some-unknown-type",
    });

    expect(mockPublisher.publishDM).not.toHaveBeenCalled();
  });

  it("sends DM but skips parser when no callbacks provided", async () => {
    const { nostrChannelProvider, setPublisher } = await import("../../src/channel-provider.js");
    setPublisher(mockPublisher as never);

    await nostrChannelProvider.sendNotification!("dm:owner123pubkey", {
      type: "friend-request",
      from: "alice",
    });

    expect(mockPublisher.publishDM).toHaveBeenCalledOnce();
    expect(nostrChannelProvider.getMessageParsers().length).toBe(0);
  });
});
