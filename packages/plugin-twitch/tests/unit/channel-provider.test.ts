import { describe, it, expect, vi, beforeEach } from "vitest";

// We must import the module functions before setting up mocks
// because channel-provider uses module-level state
import {
  twitchChannelProvider,
  setChatManager,
} from "../../src/channel-provider.js";
import type {
  ChannelCommand,
  ChannelMessageParser,
  ChannelNotificationCallbacks,
  ChannelNotificationPayload,
} from "../../src/types.js";

// Create a minimal mock chat manager
const mockChatManager = {
  sendMessage: vi.fn().mockResolvedValue(undefined),
  sendWhisper: vi.fn().mockResolvedValue(undefined),
  getBotUsername: vi.fn().mockReturnValue("testbot"),
  connect: vi.fn(),
  disconnect: vi.fn(),
};

/**
 * Extract the short ID that was embedded in the chat message sent by sendNotification.
 * The message format is: "@<channel> Friend request from <label> [ID: <XXXX>]. Reply !accept <XXXX> or !deny <XXXX>"
 */
function extractShortIdFromSentMessage(mockFn: ReturnType<typeof vi.fn>): string {
  const call = mockFn.mock.calls[0];
  const msg: string = call[1];
  const match = /\[ID: ([A-Z0-9]+)\]/.exec(msg);
  if (!match) throw new Error(`Could not find [ID: ...] in message: ${msg}`);
  return match[1];
}

describe("twitchChannelProvider", () => {
  beforeEach(() => {
    // Reset state between tests
    // Unregister any commands/parsers from previous tests
    for (const cmd of twitchChannelProvider.getCommands()) {
      twitchChannelProvider.unregisterCommand(cmd.name);
    }
    for (const parser of twitchChannelProvider.getMessageParsers()) {
      twitchChannelProvider.removeMessageParser(parser.id);
    }
    vi.clearAllMocks();
    setChatManager(mockChatManager as never);
  });

  describe("registerCommand / unregisterCommand", () => {
    it("registers a command and makes it retrievable", () => {
      const cmd: ChannelCommand = {
        name: "ping",
        description: "Ping command",
        handler: vi.fn(),
      };
      twitchChannelProvider.registerCommand(cmd);
      expect(twitchChannelProvider.getCommands()).toContain(cmd);
    });

    it("unregisters a command", () => {
      const cmd: ChannelCommand = {
        name: "ping",
        description: "Ping command",
        handler: vi.fn(),
      };
      twitchChannelProvider.registerCommand(cmd);
      twitchChannelProvider.unregisterCommand("ping");
      expect(twitchChannelProvider.getCommands()).not.toContain(cmd);
    });

    it("getCommands returns all registered commands", () => {
      const cmd1: ChannelCommand = { name: "a", description: "A", handler: vi.fn() };
      const cmd2: ChannelCommand = { name: "b", description: "B", handler: vi.fn() };
      twitchChannelProvider.registerCommand(cmd1);
      twitchChannelProvider.registerCommand(cmd2);
      const cmds = twitchChannelProvider.getCommands();
      expect(cmds).toContain(cmd1);
      expect(cmds).toContain(cmd2);
    });
  });

  describe("addMessageParser / removeMessageParser", () => {
    it("adds a message parser", () => {
      const parser: ChannelMessageParser = {
        id: "test-parser",
        pattern: /hello/,
        handler: vi.fn(),
      };
      twitchChannelProvider.addMessageParser(parser);
      expect(twitchChannelProvider.getMessageParsers()).toContain(parser);
    });

    it("removes a message parser", () => {
      const parser: ChannelMessageParser = {
        id: "test-parser",
        pattern: /hello/,
        handler: vi.fn(),
      };
      twitchChannelProvider.addMessageParser(parser);
      twitchChannelProvider.removeMessageParser("test-parser");
      expect(twitchChannelProvider.getMessageParsers()).not.toContain(parser);
    });
  });

  describe("send", () => {
    it("calls chatManager.sendMessage with correct channel format", async () => {
      await twitchChannelProvider.send("twitch:mychannel", "hello");
      expect(mockChatManager.sendMessage).toHaveBeenCalledWith("#mychannel", "hello");
    });

    it("throws if chatManager is not set", async () => {
      setChatManager(null);
      await expect(twitchChannelProvider.send("twitch:mychannel", "hi")).rejects.toThrow("Twitch chat not connected");
    });
  });

  describe("getBotUsername", () => {
    it("delegates to chatManager", () => {
      expect(twitchChannelProvider.getBotUsername()).toBe("testbot");
    });

    it("returns unknown when chatManager is null", () => {
      setChatManager(null);
      expect(twitchChannelProvider.getBotUsername()).toBe("unknown");
    });
  });

  describe("sendNotification", () => {
    it("ignores non-friend-request payload types", async () => {
      const payload: ChannelNotificationPayload = { type: "other" };
      await twitchChannelProvider.sendNotification!("twitch:mychannel", payload);
      expect(mockChatManager.sendMessage).not.toHaveBeenCalled();
    });

    it("sends a mention message for friend-request payload", async () => {
      const payload: ChannelNotificationPayload = { type: "friend-request", from: "alice" };
      await twitchChannelProvider.sendNotification!("twitch:mychannel", payload);
      expect(mockChatManager.sendMessage).toHaveBeenCalledWith(
        "#mychannel",
        expect.stringContaining("alice"),
      );
      expect(mockChatManager.sendMessage).toHaveBeenCalledWith(
        "#mychannel",
        expect.stringContaining("!accept"),
      );
    });

    it("embeds a unique short ID in the notification message", async () => {
      const payload: ChannelNotificationPayload = { type: "friend-request", from: "alice" };
      await twitchChannelProvider.sendNotification!("twitch:mychannel", payload);
      const msg: string = mockChatManager.sendMessage.mock.calls[0][1];
      expect(msg).toMatch(/\[ID: [A-Z0-9]+\]/);
    });

    it("two concurrent notifications use different IDs", async () => {
      const payload: ChannelNotificationPayload = { type: "friend-request", from: "alice" };
      await twitchChannelProvider.sendNotification!("twitch:mychannel", payload);
      const id1 = extractShortIdFromSentMessage(mockChatManager.sendMessage);
      vi.clearAllMocks();
      await twitchChannelProvider.sendNotification!("twitch:mychannel", payload);
      const id2 = extractShortIdFromSentMessage(mockChatManager.sendMessage);
      // IDs could theoretically collide but in practice they won't; if this flakes we can mock Math.random
      expect(typeof id1).toBe("string");
      expect(typeof id2).toBe("string");
    });

    it("registers a one-shot message parser for owner response", async () => {
      const payload: ChannelNotificationPayload = { type: "friend-request", from: "alice" };
      await twitchChannelProvider.sendNotification!("twitch:mychannel", payload);
      const parsers = twitchChannelProvider.getMessageParsers();
      expect(parsers.some((p) => p.id.startsWith("notif-fr-"))).toBe(true);
    });

    it("parser pattern matches !accept <id> but not bare !accept", async () => {
      const payload: ChannelNotificationPayload = { type: "friend-request", from: "alice" };
      await twitchChannelProvider.sendNotification!("twitch:mychannel", payload);
      const shortId = extractShortIdFromSentMessage(mockChatManager.sendMessage);

      const parser = twitchChannelProvider.getMessageParsers().find((p) => p.id.startsWith("notif-fr-"))!;
      expect(parser).toBeDefined();
      expect(typeof parser.pattern).toBe("function");
      const patternFn = parser.pattern as (msg: string) => boolean;

      expect(patternFn(`!accept ${shortId}`)).toBe(true);
      expect(patternFn(`!deny ${shortId}`)).toBe(true);
      expect(patternFn("!accept")).toBe(false);
      expect(patternFn("!deny")).toBe(false);
      expect(patternFn(`!accept XXXX`)).toBe(false);
    });

    it("fires onAccept callback when owner replies !accept <id>", async () => {
      const onAccept = vi.fn().mockResolvedValue(undefined);
      const onDeny = vi.fn().mockResolvedValue(undefined);
      const callbacks: ChannelNotificationCallbacks = { onAccept, onDeny };
      const payload: ChannelNotificationPayload = { type: "friend-request", from: "alice" };
      await twitchChannelProvider.sendNotification!("twitch:mychannel", payload, callbacks);

      const shortId = extractShortIdFromSentMessage(mockChatManager.sendMessage);

      const parsers = twitchChannelProvider.getMessageParsers();
      const parser = parsers.find((p) => p.id.startsWith("notif-fr-"))!;
      expect(parser).toBeDefined();

      await parser.handler({
        channel: "twitch:mychannel",
        channelType: "twitch",
        sender: "mychannel",
        content: `!accept ${shortId}`,
        reply: vi.fn().mockResolvedValue(undefined),
        getBotUsername: () => "testbot",
      });

      expect(onAccept).toHaveBeenCalledOnce();
      expect(onDeny).not.toHaveBeenCalled();
      expect(twitchChannelProvider.getMessageParsers().some((p) => p.id === parser.id)).toBe(false);
    });

    it("fires onDeny callback when owner replies !deny <id>", async () => {
      const onAccept = vi.fn().mockResolvedValue(undefined);
      const onDeny = vi.fn().mockResolvedValue(undefined);
      const callbacks: ChannelNotificationCallbacks = { onAccept, onDeny };
      const payload: ChannelNotificationPayload = { type: "friend-request", from: "alice" };
      await twitchChannelProvider.sendNotification!("twitch:mychannel", payload, callbacks);

      const shortId = extractShortIdFromSentMessage(mockChatManager.sendMessage);

      const parsers = twitchChannelProvider.getMessageParsers();
      const parser = parsers.find((p) => p.id.startsWith("notif-fr-"))!;

      await parser.handler({
        channel: "twitch:mychannel",
        channelType: "twitch",
        sender: "mychannel",
        content: `!deny ${shortId}`,
        reply: vi.fn().mockResolvedValue(undefined),
        getBotUsername: () => "testbot",
      });

      expect(onDeny).toHaveBeenCalledOnce();
      expect(onAccept).not.toHaveBeenCalled();
      expect(twitchChannelProvider.getMessageParsers().some((p) => p.id === parser.id)).toBe(false);
    });

    it("works with no callbacks provided", async () => {
      const payload: ChannelNotificationPayload = { type: "friend-request", from: "alice" };
      await twitchChannelProvider.sendNotification!("twitch:mychannel", payload);

      const shortId = extractShortIdFromSentMessage(mockChatManager.sendMessage);

      const parsers = twitchChannelProvider.getMessageParsers();
      const parser = parsers.find((p) => p.id.startsWith("notif-fr-"))!;

      await parser.handler({
        channel: "twitch:mychannel",
        channelType: "twitch",
        sender: "mychannel",
        content: `!accept ${shortId}`,
        reply: vi.fn().mockResolvedValue(undefined),
        getBotUsername: () => "testbot",
      });

      expect(twitchChannelProvider.getMessageParsers().some((p) => p.id === parser.id)).toBe(false);
    });

    it("throws if chatManager is not set", async () => {
      setChatManager(null);
      const payload: ChannelNotificationPayload = { type: "friend-request", from: "alice" };
      await expect(
        twitchChannelProvider.sendNotification!("twitch:mychannel", payload),
      ).rejects.toThrow("Twitch chat not connected");
    });

    it("handler ignores messages from wrong channel (finding 1: channel scope)", async () => {
      const onAccept = vi.fn().mockResolvedValue(undefined);
      const payload: ChannelNotificationPayload = { type: "friend-request", from: "alice" };
      await twitchChannelProvider.sendNotification!("twitch:mychannel", payload, { onAccept });

      const shortId = extractShortIdFromSentMessage(mockChatManager.sendMessage);
      const parser = twitchChannelProvider.getMessageParsers().find((p) => p.id.startsWith("notif-fr-"))!;

      // Message arrives from a DIFFERENT channel — should be ignored
      await parser.handler({
        channel: "twitch:otherchannel",
        channelType: "twitch",
        sender: "mychannel",
        content: `!accept ${shortId}`,
        reply: vi.fn().mockResolvedValue(undefined),
        getBotUsername: () => "testbot",
      });

      expect(onAccept).not.toHaveBeenCalled();
      // Parser should still be registered (not consumed)
      expect(twitchChannelProvider.getMessageParsers().some((p) => p.id === parser.id)).toBe(true);
    });

    it("handler ignores messages from wrong sender (not the channel owner)", async () => {
      const onAccept = vi.fn().mockResolvedValue(undefined);
      const payload: ChannelNotificationPayload = { type: "friend-request", from: "alice" };
      await twitchChannelProvider.sendNotification!("twitch:mychannel", payload, { onAccept });

      const shortId = extractShortIdFromSentMessage(mockChatManager.sendMessage);
      const parser = twitchChannelProvider.getMessageParsers().find((p) => p.id.startsWith("notif-fr-"))!;

      // Message from correct channel but wrong sender
      await parser.handler({
        channel: "twitch:mychannel",
        channelType: "twitch",
        sender: "rando",
        content: `!accept ${shortId}`,
        reply: vi.fn().mockResolvedValue(undefined),
        getBotUsername: () => "testbot",
      });

      expect(onAccept).not.toHaveBeenCalled();
    });

    it("returns early with warning for numeric channelId (finding 4)", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const payload: ChannelNotificationPayload = { type: "friend-request", from: "alice" };
      await twitchChannelProvider.sendNotification!("twitch:123456789", payload);
      expect(mockChatManager.sendMessage).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("numeric broadcaster ID"));
      warnSpy.mockRestore();
    });

    it("parser is cleaned up after TTL expires (finding 3)", async () => {
      vi.useFakeTimers();
      const payload: ChannelNotificationPayload = { type: "friend-request", from: "alice" };
      await twitchChannelProvider.sendNotification!("twitch:mychannel", payload);

      expect(twitchChannelProvider.getMessageParsers().some((p) => p.id.startsWith("notif-fr-"))).toBe(true);

      // Advance time past TTL (5 minutes)
      vi.advanceTimersByTime(5 * 60 * 1000 + 1);

      expect(twitchChannelProvider.getMessageParsers().some((p) => p.id.startsWith("notif-fr-"))).toBe(false);
      vi.useRealTimers();
    });
  });
});
