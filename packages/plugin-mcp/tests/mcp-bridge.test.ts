import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the MCP SDK Client
const mockClose = vi.fn().mockResolvedValue(undefined);
const mockConnect = vi.fn().mockResolvedValue(undefined);
const mockListTools = vi.fn().mockResolvedValue({
  tools: [
    { name: "sendEmail", description: "Send an email", inputSchema: { type: "object", properties: { to: { type: "string" } } } },
    { name: "listEmails", description: "List emails", inputSchema: { type: "object", properties: {} } },
  ],
});
const mockCallTool = vi.fn().mockResolvedValue({
  content: [{ type: "text", text: "sent" }],
  isError: false,
});

vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: vi.fn().mockImplementation(function () {
    return {
      connect: mockConnect,
      listTools: mockListTools,
      callTool: mockCallTool,
      close: mockClose,
    };
  }),
}));

vi.mock("../src/transports.js", () => ({
  createTransport: vi.fn().mockReturnValue({ type: "mock-transport" }),
}));

import { MCPBridge } from "../src/mcp-bridge.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function createMockCtx(): any {
  return {
    registerA2AServer: vi.fn(),
  };
}

describe("MCPBridge", () => {
  let ctx: ReturnType<typeof createMockCtx>;
  let bridge: MCPBridge;

  beforeEach(() => {
    vi.clearAllMocks();
    ctx = createMockCtx();
    bridge = new MCPBridge(ctx);
  });

  it("should connect to a server and register namespaced A2A tools", async () => {
    await bridge.connect({ name: "gmail", kind: "stdio", cmd: "npx", args: [] });

    expect(mockConnect).toHaveBeenCalledOnce();
    expect(mockListTools).toHaveBeenCalledOnce();
    expect(ctx.registerA2AServer).toHaveBeenCalledOnce();

    const config = ctx.registerA2AServer.mock.calls[0][0];
    expect(config.name).toBe("mcp-gmail");
    expect(config.tools).toHaveLength(2);
    expect(config.tools[0].name).toBe("gmail.sendEmail");
    expect(config.tools[1].name).toBe("gmail.listEmails");
  });

  it("should call the underlying MCP tool when A2A handler is invoked", async () => {
    await bridge.connect({ name: "gmail", kind: "stdio", cmd: "npx", args: [] });

    const a2aConfig = ctx.registerA2AServer.mock.calls[0][0];
    const sendEmailTool = a2aConfig.tools[0];

    const result = await sendEmailTool.handler({ to: "test@example.com" });

    expect(mockCallTool).toHaveBeenCalledWith({ name: "sendEmail", arguments: { to: "test@example.com" } });
    expect(result.content).toEqual([{ type: "text", text: "sent" }]);
    expect(result.isError).toBe(false);
  });

  it("should disconnect and close the MCP client", async () => {
    await bridge.connect({ name: "gmail", kind: "stdio", cmd: "npx", args: [] });
    await bridge.disconnect("gmail");

    expect(mockClose).toHaveBeenCalledOnce();
    expect(bridge.listServers()).toHaveLength(0);
  });

  it("should disconnect old server when reconnecting with same name", async () => {
    await bridge.connect({ name: "gmail", kind: "stdio", cmd: "npx", args: [] });
    await bridge.connect({ name: "gmail", kind: "stdio", cmd: "npx", args: [] });

    expect(mockClose).toHaveBeenCalledOnce();
    expect(ctx.registerA2AServer).toHaveBeenCalledTimes(2);
  });

  it("should list connected servers", async () => {
    await bridge.connect({ name: "gmail", kind: "stdio", cmd: "npx", args: [] });
    await bridge.connect({ name: "linear", kind: "sse", url: "https://mcp.linear.app/sse" });

    const servers = bridge.listServers();
    expect(servers).toHaveLength(2);
    expect(servers[0]).toEqual({ name: "gmail", kind: "stdio", toolCount: 2 });
    expect(servers[1]).toEqual({ name: "linear", kind: "sse", toolCount: 2 });
  });

  it("should disconnect all on disconnectAll", async () => {
    await bridge.connect({ name: "gmail", kind: "stdio", cmd: "npx", args: [] });
    await bridge.connect({ name: "linear", kind: "sse", url: "https://mcp.linear.app/sse" });

    await bridge.disconnectAll();

    expect(mockClose).toHaveBeenCalledTimes(2);
    expect(bridge.listServers()).toHaveLength(0);
  });

  it("should handle disconnect of non-existent server gracefully", async () => {
    await expect(bridge.disconnect("nonexistent")).resolves.toBeUndefined();
  });

  it("should call unregisterA2AServer on disconnect if available", async () => {
    const unregisterA2AServer = vi.fn();
    const ctxWithUnregister = {
      registerA2AServer: vi.fn(),
      unregisterA2AServer,
    };
    const bridgeWithUnregister = new MCPBridge(ctxWithUnregister as any);

    // Connect first so there's something to disconnect
    await bridgeWithUnregister.connect({ name: "test", kind: "stdio", cmd: "npx", args: [] });
    vi.clearAllMocks();

    await bridgeWithUnregister.disconnect("test");

    expect(unregisterA2AServer).toHaveBeenCalledWith("mcp-test");
  });

  it("should not throw if unregisterA2AServer is not available", async () => {
    await bridge.connect({ name: "test", kind: "stdio", cmd: "npx", args: [] });
    vi.clearAllMocks();

    // ctx has no unregisterA2AServer — should not throw
    await expect(bridge.disconnect("test")).resolves.toBeUndefined();
  });
});
