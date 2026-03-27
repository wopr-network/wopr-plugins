import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { matchesRoute } from "../src/index.js";

// The plugin uses module-level state, so we need to re-import for isolation
// We'll dynamically import it in each test suite

function createMockContext(configOverride: Record<string, unknown> = {}) {
  const config = {
    uiPort: 0, // random port to avoid conflicts
    routes: [],
    outgoingRoutes: [],
    ...configOverride,
  };

  let registeredMiddleware: {
    name: string;
    onIncoming?(input: { session: string; channel?: { type: string; id: string }; message: string }): Promise<string>;
    onOutgoing?(output: { session: string; response: string }): Promise<string>;
  } | null = null;

  let registeredA2AServer: any = null;

  const ctx = {
    log: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
    getConfig: vi.fn(() => config),
    getPluginDir: vi.fn(() => "/tmp/wopr-plugin-router-coder-2"),
    inject: vi.fn(async () => {}),
    getChannelsForSession: vi.fn(() => []),
    registerMiddleware: vi.fn((mw: typeof registeredMiddleware) => {
      registeredMiddleware = mw;
    }),
    registerUiComponent: vi.fn(),
    registerConfigSchema: vi.fn(),
    unregisterConfigSchema: vi.fn(),
    registerA2AServer: vi.fn((config: any) => { registeredA2AServer = config; }),
    unregisterExtension: vi.fn(),
  };

  return {
    ctx,
    getRegisteredMiddleware: () => registeredMiddleware,
    getRegisteredA2AServer: () => registeredA2AServer,
    updateConfig: (updates: Record<string, unknown>) => {
      Object.assign(config, updates);
    },
  };
}

describe("matchesRoute (exported)", () => {
  it("should return true when route has no filters", () => {
    expect(matchesRoute({}, { session: "any", message: "m" })).toBe(true);
  });

  it("should return false when sourceSession does not match", () => {
    expect(matchesRoute({ sourceSession: "a" }, { session: "b", message: "m" })).toBe(false);
  });

  it("should return true when sourceSession matches", () => {
    expect(matchesRoute({ sourceSession: "a" }, { session: "a", message: "m" })).toBe(true);
  });

  it("should return false when channelType does not match", () => {
    expect(
      matchesRoute(
        { channelType: "discord" },
        { session: "a", channel: { type: "slack", id: "1" }, message: "m" },
      ),
    ).toBe(false);
  });

  it("should return false when channelType specified but no channel on input", () => {
    expect(matchesRoute({ channelType: "discord" }, { session: "a", message: "m" })).toBe(false);
  });

  it("should return false when channelId does not match", () => {
    expect(
      matchesRoute(
        { channelId: "ch1" },
        { session: "a", channel: { type: "discord", id: "ch2" }, message: "m" },
      ),
    ).toBe(false);
  });

  it("should return false when channelId specified but no channel on input", () => {
    expect(matchesRoute({ channelId: "ch1" }, { session: "a", message: "m" })).toBe(false);
  });
});

describe("router plugin", () => {
  let plugin: typeof import("../src/index.ts").default;

  beforeEach(async () => {
    // Fresh import each time to reset module state
    vi.resetModules();
    const mod = await import("../src/index.ts");
    plugin = mod.default;
  });

  afterEach(async () => {
    // Ensure server is shut down after each test
    try {
      await plugin.shutdown();
    } catch {
      // ignore if already shut down
    }
  });

  describe("metadata", () => {
    it("should have correct name and version", () => {
      expect(plugin.name).toBe("router");
      expect(plugin.version).toBe("0.3.0");
      expect(plugin.description).toContain("routing");
    });
  });

  describe("init", () => {
    it("should register middleware named 'router'", async () => {
      const { ctx, getRegisteredMiddleware } = createMockContext();
      await plugin.init(ctx);

      expect(ctx.registerMiddleware).toHaveBeenCalledOnce();
      const mw = getRegisteredMiddleware();
      expect(mw).not.toBeNull();
      expect(mw!.name).toBe("router");
      expect(mw!.onIncoming).toBeTypeOf("function");
      expect(mw!.onOutgoing).toBeTypeOf("function");
    });

    it("should register UI component when registerUiComponent is available", async () => {
      const { ctx } = createMockContext();
      await plugin.init(ctx);

      expect(ctx.registerUiComponent).toHaveBeenCalledOnce();
      const call = ctx.registerUiComponent.mock.calls[0][0];
      expect(call.id).toBe("router-panel");
      expect(call.title).toBe("Message Router");
      expect(call.slot).toBe("settings");
    });

    it("should start UI server on configured port", async () => {
      const { ctx } = createMockContext({ uiPort: 0 });
      await plugin.init(ctx);

      // The server is started, log.info should have been called
      // Wait a tick for the server listen callback
      await new Promise((r) => setTimeout(r, 50));
      expect(ctx.log.info).toHaveBeenCalled();
    });

    it("should use default port 7333 when not configured", async () => {
      const { ctx } = createMockContext();
      // Remove uiPort to test default
      ctx.getConfig.mockReturnValue({ routes: [], outgoingRoutes: [] });
      await plugin.init(ctx);

      expect(ctx.registerUiComponent).toHaveBeenCalledOnce();
      const call = ctx.registerUiComponent.mock.calls[0][0];
      expect(call.moduleUrl).toContain("7333");
    });

    it("should skip registerUiComponent when not available", async () => {
      const { ctx } = createMockContext();
      const ctxNoUi = { ...ctx, registerUiComponent: undefined };
      // Should not throw
      await plugin.init(ctxNoUi as any);
      expect(ctx.registerMiddleware).toHaveBeenCalledOnce();
    });
  });

  describe("shutdown", () => {
    it("should close the UI server", async () => {
      const { ctx } = createMockContext();
      await plugin.init(ctx);
      await new Promise((r) => setTimeout(r, 50));

      await plugin.shutdown();
      expect(ctx.log.info).toHaveBeenCalledWith(
        expect.stringContaining("shutting down")
      );
    });

    it("should handle shutdown when server is already null", async () => {
      // Shutdown without init should not throw
      await plugin.shutdown();
    });
  });

  describe("onIncoming middleware", () => {
    it("should pass through message when no routes match", async () => {
      const { ctx, getRegisteredMiddleware } = createMockContext({
        routes: [
          { sourceSession: "other-session", targetSessions: ["target1"] },
        ],
      });
      await plugin.init(ctx);
      const mw = getRegisteredMiddleware()!;

      const result = await mw.onIncoming!({
        session: "my-session",
        message: "hello",
      });

      expect(result).toBe("hello");
      expect(ctx.inject).not.toHaveBeenCalled();
    });

    it("should fan out to target sessions when route matches by source session", async () => {
      const { ctx, getRegisteredMiddleware } = createMockContext({
        routes: [
          {
            sourceSession: "session-a",
            targetSessions: ["session-b", "session-c"],
          },
        ],
      });
      await plugin.init(ctx);
      const mw = getRegisteredMiddleware()!;

      const result = await mw.onIncoming!({
        session: "session-a",
        message: "hello world",
      });

      expect(result).toBe("hello world");
      expect(ctx.inject).toHaveBeenCalledTimes(2);
      expect(ctx.inject).toHaveBeenCalledWith("session-b", "hello world");
      expect(ctx.inject).toHaveBeenCalledWith("session-c", "hello world");
    });

    it("should not fan out to the source session itself", async () => {
      const { ctx, getRegisteredMiddleware } = createMockContext({
        routes: [
          {
            sourceSession: "session-a",
            targetSessions: ["session-a", "session-b"],
          },
        ],
      });
      await plugin.init(ctx);
      const mw = getRegisteredMiddleware()!;

      await mw.onIncoming!({
        session: "session-a",
        message: "hello",
      });

      // session-a should be skipped (self), only session-b should receive
      expect(ctx.inject).toHaveBeenCalledTimes(1);
      expect(ctx.inject).toHaveBeenCalledWith("session-b", "hello");
    });

    it("should skip empty target sessions", async () => {
      const { ctx, getRegisteredMiddleware } = createMockContext({
        routes: [
          {
            sourceSession: "session-a",
            targetSessions: ["", "session-b", ""],
          },
        ],
      });
      await plugin.init(ctx);
      const mw = getRegisteredMiddleware()!;

      await mw.onIncoming!({
        session: "session-a",
        message: "hello",
      });

      expect(ctx.inject).toHaveBeenCalledTimes(1);
      expect(ctx.inject).toHaveBeenCalledWith("session-b", "hello");
    });

    it("should match route by channel type", async () => {
      const { ctx, getRegisteredMiddleware } = createMockContext({
        routes: [
          {
            channelType: "discord",
            targetSessions: ["session-b"],
          },
        ],
      });
      await plugin.init(ctx);
      const mw = getRegisteredMiddleware()!;

      const result = await mw.onIncoming!({
        session: "session-a",
        channel: { type: "discord", id: "ch1" },
        message: "hello",
      });

      expect(result).toBe("hello");
      expect(ctx.inject).toHaveBeenCalledWith("session-b", "hello");
    });

    it("should not match when channel type differs", async () => {
      const { ctx, getRegisteredMiddleware } = createMockContext({
        routes: [
          {
            channelType: "discord",
            targetSessions: ["session-b"],
          },
        ],
      });
      await plugin.init(ctx);
      const mw = getRegisteredMiddleware()!;

      await mw.onIncoming!({
        session: "session-a",
        channel: { type: "slack", id: "ch1" },
        message: "hello",
      });

      expect(ctx.inject).not.toHaveBeenCalled();
    });

    it("should match route by channel id", async () => {
      const { ctx, getRegisteredMiddleware } = createMockContext({
        routes: [
          {
            channelId: "specific-channel",
            targetSessions: ["session-b"],
          },
        ],
      });
      await plugin.init(ctx);
      const mw = getRegisteredMiddleware()!;

      await mw.onIncoming!({
        session: "session-a",
        channel: { type: "discord", id: "specific-channel" },
        message: "hello",
      });

      expect(ctx.inject).toHaveBeenCalledWith("session-b", "hello");
    });

    it("should not match when channel id differs", async () => {
      const { ctx, getRegisteredMiddleware } = createMockContext({
        routes: [
          {
            channelId: "specific-channel",
            targetSessions: ["session-b"],
          },
        ],
      });
      await plugin.init(ctx);
      const mw = getRegisteredMiddleware()!;

      await mw.onIncoming!({
        session: "session-a",
        channel: { type: "discord", id: "other-channel" },
        message: "hello",
      });

      expect(ctx.inject).not.toHaveBeenCalled();
    });

    it("should match multiple routes and fan out to all targets", async () => {
      const { ctx, getRegisteredMiddleware } = createMockContext({
        routes: [
          {
            sourceSession: "session-a",
            targetSessions: ["session-b"],
          },
          {
            sourceSession: "session-a",
            targetSessions: ["session-c"],
          },
        ],
      });
      await plugin.init(ctx);
      const mw = getRegisteredMiddleware()!;

      await mw.onIncoming!({
        session: "session-a",
        message: "hello",
      });

      expect(ctx.inject).toHaveBeenCalledTimes(2);
      expect(ctx.inject).toHaveBeenCalledWith("session-b", "hello");
      expect(ctx.inject).toHaveBeenCalledWith("session-c", "hello");
    });

    it("should handle routes with no targetSessions", async () => {
      const { ctx, getRegisteredMiddleware } = createMockContext({
        routes: [
          {
            sourceSession: "session-a",
            // no targetSessions
          },
        ],
      });
      await plugin.init(ctx);
      const mw = getRegisteredMiddleware()!;

      await mw.onIncoming!({
        session: "session-a",
        message: "hello",
      });

      expect(ctx.inject).not.toHaveBeenCalled();
    });

    it("should handle empty routes array", async () => {
      const { ctx, getRegisteredMiddleware } = createMockContext({
        routes: [],
      });
      await plugin.init(ctx);
      const mw = getRegisteredMiddleware()!;

      const result = await mw.onIncoming!({
        session: "session-a",
        message: "hello",
      });

      expect(result).toBe("hello");
      expect(ctx.inject).not.toHaveBeenCalled();
    });

    it("should re-read config on each invocation", async () => {
      const { ctx, getRegisteredMiddleware, updateConfig } = createMockContext({
        routes: [],
      });
      await plugin.init(ctx);
      const mw = getRegisteredMiddleware()!;

      // First call: no routes
      await mw.onIncoming!({ session: "a", message: "m" });
      expect(ctx.inject).not.toHaveBeenCalled();

      // Update config with a route
      updateConfig({
        routes: [{ sourceSession: "a", targetSessions: ["b"] }],
      });

      // Second call: should use updated config
      await mw.onIncoming!({ session: "a", message: "m2" });
      expect(ctx.inject).toHaveBeenCalledWith("b", "m2");
    });
  });

  describe("onOutgoing middleware", () => {
    it("should pass through response when no outgoing routes match", async () => {
      const { ctx, getRegisteredMiddleware } = createMockContext({
        outgoingRoutes: [{ sourceSession: "other-session" }],
      });
      await plugin.init(ctx);
      const mw = getRegisteredMiddleware()!;

      const result = await mw.onOutgoing!({
        session: "my-session",
        response: "reply",
      });

      expect(result).toBe("reply");
    });

    it("should fan out to channels matching route", async () => {
      const mockSend = vi.fn(async () => {});
      const { ctx, getRegisteredMiddleware } = createMockContext({
        outgoingRoutes: [{ sourceSession: "session-a", channelType: "discord" }],
      });
      ctx.getChannelsForSession.mockReturnValue([
        { channel: { type: "discord", id: "ch1" }, send: mockSend },
        { channel: { type: "slack", id: "ch2" }, send: vi.fn() },
      ]);
      await plugin.init(ctx);
      const mw = getRegisteredMiddleware()!;

      const result = await mw.onOutgoing!({
        session: "session-a",
        response: "reply",
      });

      expect(result).toBe("reply");
      expect(mockSend).toHaveBeenCalledWith("reply");
      // slack adapter should not have been called
      expect(ctx.getChannelsForSession.mock.results[0].value[1].send).not.toHaveBeenCalled();
    });

    it("should fan out to all channels when no filter specified", async () => {
      const send1 = vi.fn(async () => {});
      const send2 = vi.fn(async () => {});
      const { ctx, getRegisteredMiddleware } = createMockContext({
        outgoingRoutes: [{ sourceSession: "session-a" }],
      });
      ctx.getChannelsForSession.mockReturnValue([
        { channel: { type: "discord", id: "ch1" }, send: send1 },
        { channel: { type: "slack", id: "ch2" }, send: send2 },
      ]);
      await plugin.init(ctx);
      const mw = getRegisteredMiddleware()!;

      await mw.onOutgoing!({
        session: "session-a",
        response: "broadcast reply",
      });

      expect(send1).toHaveBeenCalledWith("broadcast reply");
      expect(send2).toHaveBeenCalledWith("broadcast reply");
    });

    it("should filter by channelId", async () => {
      const send1 = vi.fn(async () => {});
      const send2 = vi.fn(async () => {});
      const { ctx, getRegisteredMiddleware } = createMockContext({
        outgoingRoutes: [{ sourceSession: "session-a", channelId: "ch2" }],
      });
      ctx.getChannelsForSession.mockReturnValue([
        { channel: { type: "discord", id: "ch1" }, send: send1 },
        { channel: { type: "slack", id: "ch2" }, send: send2 },
      ]);
      await plugin.init(ctx);
      const mw = getRegisteredMiddleware()!;

      await mw.onOutgoing!({
        session: "session-a",
        response: "targeted reply",
      });

      expect(send1).not.toHaveBeenCalled();
      expect(send2).toHaveBeenCalledWith("targeted reply");
    });

    it("should handle empty outgoing routes", async () => {
      const { ctx, getRegisteredMiddleware } = createMockContext({
        outgoingRoutes: [],
      });
      await plugin.init(ctx);
      const mw = getRegisteredMiddleware()!;

      const result = await mw.onOutgoing!({
        session: "session-a",
        response: "reply",
      });

      expect(result).toBe("reply");
      expect(ctx.getChannelsForSession).not.toHaveBeenCalled();
    });

    it("should handle undefined outgoing routes in config", async () => {
      const { ctx, getRegisteredMiddleware } = createMockContext();
      ctx.getConfig.mockReturnValue({ routes: [] }); // no outgoingRoutes key
      await plugin.init(ctx);
      const mw = getRegisteredMiddleware()!;

      const result = await mw.onOutgoing!({
        session: "session-a",
        response: "reply",
      });

      expect(result).toBe("reply");
    });
  });

  describe("route matching combinations", () => {
    it("should require all specified fields to match", async () => {
      const { ctx, getRegisteredMiddleware } = createMockContext({
        routes: [
          {
            sourceSession: "session-a",
            channelType: "discord",
            channelId: "ch1",
            targetSessions: ["session-b"],
          },
        ],
      });
      await plugin.init(ctx);
      const mw = getRegisteredMiddleware()!;

      // All match
      await mw.onIncoming!({
        session: "session-a",
        channel: { type: "discord", id: "ch1" },
        message: "hello",
      });
      expect(ctx.inject).toHaveBeenCalledTimes(1);

      ctx.inject.mockClear();

      // Session doesn't match
      await mw.onIncoming!({
        session: "session-b",
        channel: { type: "discord", id: "ch1" },
        message: "hello",
      });
      expect(ctx.inject).not.toHaveBeenCalled();

      // Channel type doesn't match
      await mw.onIncoming!({
        session: "session-a",
        channel: { type: "slack", id: "ch1" },
        message: "hello",
      });
      expect(ctx.inject).not.toHaveBeenCalled();

      // Channel id doesn't match
      await mw.onIncoming!({
        session: "session-a",
        channel: { type: "discord", id: "ch2" },
        message: "hello",
      });
      expect(ctx.inject).not.toHaveBeenCalled();
    });

    it("should match wildcard route (no filters)", async () => {
      const { ctx, getRegisteredMiddleware } = createMockContext({
        routes: [
          {
            targetSessions: ["session-b"],
          },
        ],
      });
      await plugin.init(ctx);
      const mw = getRegisteredMiddleware()!;

      await mw.onIncoming!({
        session: "any-session",
        channel: { type: "any", id: "any" },
        message: "hello",
      });

      expect(ctx.inject).toHaveBeenCalledWith("session-b", "hello");
    });
  });

  describe("error paths in fan-out", () => {
    it("should log error and increment errors when inject throws", async () => {
      const { ctx, getRegisteredMiddleware } = createMockContext({
        routes: [{ sourceSession: "session-a", targetSessions: ["session-b"] }],
      });
      ctx.inject.mockRejectedValueOnce(new Error("inject failed"));
      await plugin.init(ctx);
      const mw = getRegisteredMiddleware()!;

      const result = await mw.onIncoming!({
        session: "session-a",
        message: "hello",
      });

      expect(result).toBe("hello");
      expect(ctx.log.error).toHaveBeenCalledWith(expect.stringContaining("Failed to route"));
    });

    it("should log error and increment errors when channel send throws", async () => {
      const failSend = vi.fn(async () => { throw new Error("send failed"); });
      const { ctx, getRegisteredMiddleware } = createMockContext({
        outgoingRoutes: [{ sourceSession: "session-a" }],
      });
      ctx.getChannelsForSession.mockReturnValue([
        { channel: { type: "discord", id: "ch1" }, send: failSend },
      ]);
      await plugin.init(ctx);
      const mw = getRegisteredMiddleware()!;

      const result = await mw.onOutgoing!({
        session: "session-a",
        response: "reply",
      });

      expect(result).toBe("reply");
      expect(ctx.log.error).toHaveBeenCalledWith(expect.stringContaining("Failed to send"));
    });
  });

  describe("A2A router.stats tool", () => {
    it("should register A2A server with router.stats tool", async () => {
      const { ctx, getRegisteredA2AServer } = createMockContext();
      await plugin.init(ctx);
      const server = getRegisteredA2AServer();
      expect(server).not.toBeNull();
      expect(server.name).toBe("router");
      expect(server.tools).toHaveLength(1);
      expect(server.tools[0].name).toBe("router.stats");
    });

    it("should return stats JSON from router.stats handler", async () => {
      const { ctx, getRegisteredA2AServer } = createMockContext();
      await plugin.init(ctx);
      const server = getRegisteredA2AServer();
      const result = await server.tools[0].handler();
      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe("text");
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.messages).toBeDefined();
      expect(parsed.messages.routed).toBe(0);
    });
  });
});
