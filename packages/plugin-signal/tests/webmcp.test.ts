import { afterEach, describe, expect, it, vi } from "vitest";

// Mock client module
vi.mock("../src/client.js", () => ({
  signalRpcRequest: vi.fn().mockResolvedValue(undefined),
  signalCheck: vi.fn().mockResolvedValue({ ok: false, status: null, error: "mocked" }),
  streamSignalEvents: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../src/daemon.js", () => ({
  spawnSignalDaemon: vi.fn().mockReturnValue({ pid: 12345, stop: vi.fn() }),
  waitForSignalDaemonReady: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("winston", () => {
  const mockLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
  return {
    default: {
      createLogger: vi.fn().mockReturnValue(mockLogger),
      format: {
        combine: vi.fn(),
        timestamp: vi.fn(),
        errors: vi.fn(),
        json: vi.fn(),
        colorize: vi.fn(),
        simple: vi.fn(),
      },
      transports: {
        File: vi.fn(),
        Console: vi.fn(),
      },
    },
  };
});

import { signalCheck, signalRpcRequest } from "../src/client.js";
import { getWebMCPHandlers, initWebMCP, teardownWebMCP, webmcpToolDeclarations } from "../src/webmcp.js";

describe("webmcpToolDeclarations", () => {
  it("declares exactly three tools", () => {
    expect(webmcpToolDeclarations).toHaveLength(3);
  });

  it("declares getSignalStatus", () => {
    const tool = webmcpToolDeclarations.find((t) => t.name === "getSignalStatus");
    expect(tool).toBeDefined();
    expect(tool?.description).toContain("connection status");
  });

  it("declares listSignalChats", () => {
    const tool = webmcpToolDeclarations.find((t) => t.name === "listSignalChats");
    expect(tool).toBeDefined();
    expect(tool?.description).toContain("conversations");
  });

  it("declares getSignalMessageStats", () => {
    const tool = webmcpToolDeclarations.find((t) => t.name === "getSignalMessageStats");
    expect(tool).toBeDefined();
    expect(tool?.description).toContain("statistics");
  });

  it("all tools have name, description, and parameters", () => {
    for (const tool of webmcpToolDeclarations) {
      expect(tool.name).toBeTruthy();
      expect(tool.description).toBeTruthy();
      expect(tool.parameters).toBeDefined();
    }
  });
});

describe("getWebMCPHandlers", () => {
  it("returns handlers for all three tools", () => {
    const handlers = getWebMCPHandlers();
    expect(handlers.getSignalStatus).toBeTypeOf("function");
    expect(handlers.listSignalChats).toBeTypeOf("function");
    expect(handlers.getSignalMessageStats).toBeTypeOf("function");
  });
});

describe("getSignalStatus handler", () => {
  afterEach(() => {
    teardownWebMCP();
    vi.clearAllMocks();
  });

  it("returns error when plugin not initialized", async () => {
    teardownWebMCP();
    const handlers = getWebMCPHandlers();
    const result = await handlers.getSignalStatus();
    expect(result.connected).toBe(false);
    expect(result.error).toContain("not initialized");
  });

  it("returns disconnected when daemon is unreachable", async () => {
    vi.mocked(signalCheck).mockResolvedValueOnce({
      ok: false,
      status: null,
      error: "ECONNREFUSED",
    });

    initWebMCP({
      getBaseUrl: () => "http://127.0.0.1:8080",
      getAccount: () => "+15551234567",
      getMessageCache: () => new Map(),
      isConnected: () => false,
    });

    const handlers = getWebMCPHandlers();
    const result = await handlers.getSignalStatus();
    expect(result.connected).toBe(false);
    expect(result.daemonStatus).toBe("unreachable");
    expect(result.error).toBe("ECONNREFUSED");
  });

  it("masks phone number in status response", async () => {
    vi.mocked(signalCheck).mockResolvedValueOnce({
      ok: false,
      status: null,
      error: "timeout",
    });

    initWebMCP({
      getBaseUrl: () => "http://127.0.0.1:8080",
      getAccount: () => "+15551234567",
      getMessageCache: () => new Map(),
      isConnected: () => false,
    });

    const handlers = getWebMCPHandlers();
    const result = await handlers.getSignalStatus();
    // Phone number should be masked, not fully visible
    expect(result.account).not.toBe("+15551234567");
    expect(typeof result.account).toBe("string");
    expect(result.account as string).toContain("4567");
  });

  it("returns connected when daemon is reachable", async () => {
    vi.mocked(signalCheck).mockResolvedValueOnce({
      ok: true,
      status: 200,
      error: null,
    });
    vi.mocked(signalRpcRequest).mockResolvedValueOnce([{ number: "+15551234567", uuid: "uuid-123", device: 1 }]);

    initWebMCP({
      getBaseUrl: () => "http://127.0.0.1:8080",
      getAccount: () => "+15551234567",
      getMessageCache: () => new Map(),
      isConnected: () => true,
    });

    const handlers = getWebMCPHandlers();
    const result = await handlers.getSignalStatus();
    expect(result.connected).toBe(true);
    expect(result.daemonStatus).toBe("running");
    expect(result.accountCount).toBe(1);
    expect(result.registeredDevice).toEqual({ deviceId: 1 });
  });

  it("handles listAccounts RPC failure gracefully", async () => {
    vi.mocked(signalCheck).mockResolvedValueOnce({
      ok: true,
      status: 200,
      error: null,
    });
    vi.mocked(signalRpcRequest).mockRejectedValueOnce(new Error("method not found"));

    initWebMCP({
      getBaseUrl: () => "http://127.0.0.1:8080",
      getAccount: () => "+15551234567",
      getMessageCache: () => new Map(),
      isConnected: () => true,
    });

    const handlers = getWebMCPHandlers();
    const result = await handlers.getSignalStatus();
    expect(result.connected).toBe(true);
    expect(result.accountCount).toBe(0);
  });

  it("returns null account when no account configured", async () => {
    vi.mocked(signalCheck).mockResolvedValueOnce({
      ok: true,
      status: 200,
      error: null,
    });
    vi.mocked(signalRpcRequest).mockResolvedValueOnce([]);

    initWebMCP({
      getBaseUrl: () => "http://127.0.0.1:8080",
      getAccount: () => undefined,
      getMessageCache: () => new Map(),
      isConnected: () => true,
    });

    const handlers = getWebMCPHandlers();
    const result = await handlers.getSignalStatus();
    expect(result.account).toBeNull();
  });
});

describe("listSignalChats handler", () => {
  afterEach(() => {
    teardownWebMCP();
  });

  it("returns error when plugin not initialized", async () => {
    teardownWebMCP();
    const handlers = getWebMCPHandlers();
    const result = await handlers.listSignalChats();
    expect(result.chats).toEqual([]);
    expect(result.error).toContain("not initialized");
  });

  it("returns empty list when no messages cached", async () => {
    initWebMCP({
      getBaseUrl: () => "http://127.0.0.1:8080",
      getAccount: () => "+15551234567",
      getMessageCache: () => new Map(),
      isConnected: () => true,
    });

    const handlers = getWebMCPHandlers();
    const result = await handlers.listSignalChats();
    expect(result.chats).toEqual([]);
    expect(result.totalChats).toBe(0);
  });

  it("lists DM conversations from message cache", async () => {
    const cache = new Map<string, any>();
    cache.set("msg-1", { isGroup: false, from: "+15559991111" });
    cache.set("msg-2", { isGroup: false, from: "+15559992222" });

    initWebMCP({
      getBaseUrl: () => "http://127.0.0.1:8080",
      getAccount: () => "+15551234567",
      getMessageCache: () => cache,
      isConnected: () => true,
    });

    const handlers = getWebMCPHandlers();
    const result = await handlers.listSignalChats();
    const chats = result.chats as Array<{ id: string; type: string; messageCount: number }>;
    expect(chats).toHaveLength(2);
    expect(chats.every((c) => c.type === "dm")).toBe(true);
    expect(result.totalChats).toBe(2);
  });

  it("lists group conversations from message cache", async () => {
    const cache = new Map<string, any>();
    cache.set("msg-1", { isGroup: true, groupId: "group-abc", from: "+15559991111" });
    cache.set("msg-2", { isGroup: true, groupId: "group-abc", from: "+15559992222" });

    initWebMCP({
      getBaseUrl: () => "http://127.0.0.1:8080",
      getAccount: () => "+15551234567",
      getMessageCache: () => cache,
      isConnected: () => true,
    });

    const handlers = getWebMCPHandlers();
    const result = await handlers.listSignalChats();
    const chats = result.chats as Array<{ id: string; type: string; messageCount: number }>;
    expect(chats).toHaveLength(1);
    expect(chats[0].type).toBe("group");
    expect(chats[0].id).toBe("group:group-abc");
    expect(chats[0].messageCount).toBe(2);
  });

  it("lists mixed DM and group conversations", async () => {
    const cache = new Map<string, any>();
    cache.set("msg-1", { isGroup: false, from: "+15559991111" });
    cache.set("msg-2", { isGroup: true, groupId: "group-abc", from: "+15559991111" });
    cache.set("msg-3", { isGroup: false, from: "+15559991111" });

    initWebMCP({
      getBaseUrl: () => "http://127.0.0.1:8080",
      getAccount: () => "+15551234567",
      getMessageCache: () => cache,
      isConnected: () => true,
    });

    const handlers = getWebMCPHandlers();
    const result = await handlers.listSignalChats();
    const chats = result.chats as Array<{ id: string; type: string; messageCount: number }>;
    expect(chats).toHaveLength(2);
    expect(result.totalChats).toBe(2);

    const dm = chats.find((c) => c.type === "dm");
    expect(dm).toBeDefined();
    expect(dm?.messageCount).toBe(2);

    const group = chats.find((c) => c.type === "group");
    expect(group).toBeDefined();
    expect(group?.messageCount).toBe(1);
  });
});

describe("getSignalMessageStats handler", () => {
  afterEach(() => {
    teardownWebMCP();
  });

  it("returns error when plugin not initialized", async () => {
    teardownWebMCP();
    const handlers = getWebMCPHandlers();
    const result = await handlers.getSignalMessageStats();
    expect(result.totalMessages).toBe(0);
    expect(result.activeConversations).toBe(0);
    expect(result.error).toContain("not initialized");
  });

  it("returns zero stats for empty cache", async () => {
    initWebMCP({
      getBaseUrl: () => "http://127.0.0.1:8080",
      getAccount: () => "+15551234567",
      getMessageCache: () => new Map(),
      isConnected: () => true,
    });

    const handlers = getWebMCPHandlers();
    const result = await handlers.getSignalMessageStats();
    expect(result.totalMessages).toBe(0);
    expect(result.activeConversations).toBe(0);
    expect(result.dmConversations).toBe(0);
    expect(result.groupConversations).toBe(0);
  });

  it("returns correct counts for mixed messages", async () => {
    const cache = new Map<string, any>();
    cache.set("msg-1", { isGroup: false, from: "+15559991111" });
    cache.set("msg-2", { isGroup: false, from: "+15559992222" });
    cache.set("msg-3", { isGroup: true, groupId: "group-abc", from: "+15559991111" });
    cache.set("msg-4", { isGroup: true, groupId: "group-abc", from: "+15559992222" });
    cache.set("msg-5", { isGroup: false, from: "+15559991111" });

    initWebMCP({
      getBaseUrl: () => "http://127.0.0.1:8080",
      getAccount: () => "+15551234567",
      getMessageCache: () => cache,
      isConnected: () => true,
    });

    const handlers = getWebMCPHandlers();
    const result = await handlers.getSignalMessageStats();
    expect(result.totalMessages).toBe(5);
    expect(result.activeConversations).toBe(3); // 2 DM contacts + 1 group
    expect(result.dmConversations).toBe(3); // 3 DM messages
    expect(result.groupConversations).toBe(2); // 2 group messages
  });
});

describe("security: no private data exposure", () => {
  afterEach(() => {
    teardownWebMCP();
  });

  it("getSignalStatus does not expose full phone number", async () => {
    vi.mocked(signalCheck).mockResolvedValueOnce({
      ok: true,
      status: 200,
      error: null,
    });
    vi.mocked(signalRpcRequest).mockResolvedValueOnce([{ number: "+15551234567", uuid: "uuid-123", device: 1 }]);

    initWebMCP({
      getBaseUrl: () => "http://127.0.0.1:8080",
      getAccount: () => "+15551234567",
      getMessageCache: () => new Map(),
      isConnected: () => true,
    });

    const handlers = getWebMCPHandlers();
    const result = await handlers.getSignalStatus();
    const resultStr = JSON.stringify(result);
    // The full phone number should not appear anywhere in the response
    expect(resultStr).not.toContain("+15551234567");
    // But the masked version with last 4 digits should be present
    expect(resultStr).toContain("4567");
  });

  it("getSignalStatus does not expose UUIDs from listAccounts", async () => {
    vi.mocked(signalCheck).mockResolvedValueOnce({
      ok: true,
      status: 200,
      error: null,
    });
    vi.mocked(signalRpcRequest).mockResolvedValueOnce([
      { number: "+15551234567", uuid: "secret-uuid-abc123", device: 1 },
    ]);

    initWebMCP({
      getBaseUrl: () => "http://127.0.0.1:8080",
      getAccount: () => "+15551234567",
      getMessageCache: () => new Map(),
      isConnected: () => true,
    });

    const handlers = getWebMCPHandlers();
    const result = await handlers.getSignalStatus();
    const resultStr = JSON.stringify(result);
    expect(resultStr).not.toContain("secret-uuid-abc123");
  });
});
