import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock Twurple ChatClient before importing chat-client
vi.mock("@twurple/chat", () => {
  return {
    ChatClient: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
      let connectCallback: (() => void) | null = null;
      this.onMessage = vi.fn();
      this.onWhisper = vi.fn();
      this.onSub = vi.fn();
      this.onResub = vi.fn();
      this.onRaid = vi.fn();
      this.onConnect = vi.fn().mockImplementation((cb: () => void) => {
        connectCallback = cb;
      });
      this.onDisconnect = vi.fn();
      this.connect = vi.fn().mockImplementation(() => {
        // Simulate immediate connection
        if (connectCallback) setTimeout(connectCallback, 0);
      });
      this.quit = vi.fn();
      this.say = vi.fn().mockResolvedValue(undefined);
    }),
  };
});

import { TwitchChatManager } from "../../src/chat-client.js";
import type { TwitchConfig } from "../../src/types.js";

const makeCtx = () => ({
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
  logMessage: vi.fn(),
  inject: vi.fn().mockResolvedValue("bot response"),
  getConfig: vi.fn(),
  registerConfigSchema: vi.fn(),
  registerChannelProvider: vi.fn(),
  unregisterChannelProvider: vi.fn(),
  saveConfig: vi.fn(),
  storage: {} as never,
  events: {} as never,
  hooks: {} as never,
  dataDir: "/tmp",
});

const makeAuthProvider = () => ({} as never);

describe("TwitchChatManager", () => {
  describe("message splitting", () => {
    it("does not split messages under 500 chars", () => {
      const config: TwitchConfig = { channels: ["test"], commandPrefix: "!" };
      const manager = new TwitchChatManager(makeCtx() as never, config);
      const chunks = manager.splitMessagePublic("hello world", 500);
      expect(chunks).toHaveLength(1);
      expect(chunks[0]).toBe("hello world");
    });

    it("splits messages over 500 chars at word boundaries", () => {
      const config: TwitchConfig = { channels: ["test"], commandPrefix: "!" };
      const manager = new TwitchChatManager(makeCtx() as never, config);
      // Create a message that's 600 chars
      const word = "word ";
      const longMessage = word.repeat(120); // 600 chars
      const chunks = manager.splitMessagePublic(longMessage, 500);
      expect(chunks.length).toBeGreaterThan(1);
      for (const chunk of chunks) {
        expect(chunk.length).toBeLessThanOrEqual(500);
      }
      // Verify content is preserved
      expect(chunks.join(" ").replace(/\s+/g, " ").trim()).toBe(longMessage.trim());
    });

    it("handles messages with no spaces gracefully", () => {
      const config: TwitchConfig = { channels: ["test"], commandPrefix: "!" };
      const manager = new TwitchChatManager(makeCtx() as never, config);
      const longNoSpaces = "a".repeat(600);
      const chunks = manager.splitMessagePublic(longNoSpaces, 500);
      expect(chunks.length).toBeGreaterThan(1);
      expect(chunks.join("")).toBe(longNoSpaces);
    });
  });

  describe("handleMessage skips own messages", () => {
    it("does not inject when message is from the bot itself", async () => {
      const ctx = makeCtx();
      const config: TwitchConfig = { channels: ["testchan"], commandPrefix: "!" };
      const manager = new TwitchChatManager(ctx as never, config);
      await manager.connect(makeAuthProvider());
      manager.setBotUsername("woprbot");

      // Simulate an incoming message from the bot itself
      await manager.handleMessagePublic("#testchan", "woprbot", "hello", {
        userInfo: {
          userId: "bot-id",
          userName: "woprbot",
          displayName: "WOPRBot",
          isMod: false,
          isSubscriber: false,
          isVip: false,
          isBroadcaster: false,
          badges: new Map(),
          color: undefined,
        },
      } as never);

      expect(ctx.inject).not.toHaveBeenCalled();
    });
  });

  describe("handleMessage for real user", () => {
    it("calls ctx.inject with correct session key and channel ref", async () => {
      const ctx = makeCtx();
      const config: TwitchConfig = { channels: ["mychannel"], commandPrefix: "!" };
      const manager = new TwitchChatManager(ctx as never, config);
      await manager.connect(makeAuthProvider());

      await manager.handleMessagePublic("#mychannel", "viewer1", "hello bot", {
        userInfo: {
          userId: "viewer-id-1",
          userName: "viewer1",
          displayName: "Viewer1",
          isMod: false,
          isSubscriber: false,
          isVip: false,
          isBroadcaster: false,
          badges: new Map(),
          color: undefined,
        },
      } as never);

      expect(ctx.inject).toHaveBeenCalledWith(
        "twitch-mychannel",
        expect.stringContaining("hello bot"),
        expect.objectContaining({
          from: "Viewer1",
          channel: expect.objectContaining({ type: "twitch", id: "twitch:mychannel" }),
        }),
      );
    });
  });

  describe("handleWhisper", () => {
    it("does not inject when dmPolicy is disabled", async () => {
      const ctx = makeCtx();
      const config: TwitchConfig = { channels: ["test"], commandPrefix: "!", dmPolicy: "disabled" };
      const manager = new TwitchChatManager(ctx as never, config);
      await manager.connect(makeAuthProvider());

      await manager.handleWhisperPublic("someuser", "hello", {
        userInfo: {
          userId: "user-id",
          userName: "someuser",
          displayName: "SomeUser",
          isMod: false,
          isSubscriber: false,
          isVip: false,
          isBroadcaster: false,
          badges: new Map(),
          color: undefined,
        },
      } as never);

      expect(ctx.inject).not.toHaveBeenCalled();
    });

    it("injects with whisper session key when dmPolicy is open", async () => {
      const ctx = makeCtx();
      const config: TwitchConfig = { channels: ["test"], commandPrefix: "!", enableWhispers: true };
      const manager = new TwitchChatManager(ctx as never, config);
      await manager.connect(makeAuthProvider());

      await manager.handleWhisperPublic("someuser", "private message", {
        userInfo: {
          userId: "user-id-42",
          userName: "someuser",
          displayName: "SomeUser",
          isMod: false,
          isSubscriber: false,
          isVip: false,
          isBroadcaster: false,
          badges: new Map(),
          color: undefined,
        },
      } as never);

      expect(ctx.inject).toHaveBeenCalledWith(
        "twitch-whisper-user-id-42",
        expect.stringContaining("private message"),
        expect.objectContaining({
          from: "SomeUser",
          channel: expect.objectContaining({ type: "twitch" }),
        }),
      );
    });
  });
});
