import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("nostrChannelProvider", () => {
  let mockPublisher: {
    publishDM: ReturnType<typeof vi.fn>;
    publishReply: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    mockPublisher = {
      publishDM: vi.fn().mockResolvedValue("event-id"),
      publishReply: vi.fn().mockResolvedValue("reply-id"),
    };
  });

  afterEach(async () => {
    const { nostrChannelProvider } = await import("../../src/channel-provider.js");
    for (const cmd of nostrChannelProvider.getCommands()) {
      nostrChannelProvider.unregisterCommand(cmd.name);
    }
  });

  it("send with dm:<pubkey> calls publisher.publishDM with correct pubkey and content", async () => {
    const { nostrChannelProvider, setPublisher } = await import("../../src/channel-provider.js");
    setPublisher(mockPublisher as never);

    await nostrChannelProvider.send("dm:abc123pubkey", "hello world");

    expect(mockPublisher.publishDM).toHaveBeenCalledWith("hello world", "abc123pubkey");
  });

  it("send throws when publisher not initialized", async () => {
    const { nostrChannelProvider, setPublisher } = await import("../../src/channel-provider.js");
    setPublisher(null);

    await expect(nostrChannelProvider.send("dm:abc", "hello")).rejects.toThrow(
      "Nostr publisher not initialized",
    );
  });

  it("send throws on unsupported channel format", async () => {
    const { nostrChannelProvider, setPublisher } = await import("../../src/channel-provider.js");
    setPublisher(mockPublisher as never);

    await expect(nostrChannelProvider.send("unknown:format", "hello")).rejects.toThrow(
      "Unsupported Nostr channel format",
    );
  });

  it("getBotUsername returns the configured bot npub", async () => {
    const { nostrChannelProvider, setBotNpub } = await import("../../src/channel-provider.js");
    setBotNpub("npub1testuser");

    expect(nostrChannelProvider.getBotUsername()).toBe("npub1testuser");
  });

  it("registerCommand and getCommands work correctly", async () => {
    const { nostrChannelProvider } = await import("../../src/channel-provider.js");
    const cmd = {
      name: "test-cmd",
      description: "Test command",
      handler: vi.fn(),
    };

    nostrChannelProvider.registerCommand(cmd);
    const commands = nostrChannelProvider.getCommands();

    expect(commands).toContainEqual(cmd);
    nostrChannelProvider.unregisterCommand("test-cmd");
  });
});
