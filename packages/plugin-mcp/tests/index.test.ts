import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock bridge
const mockConnect = vi.fn().mockResolvedValue(undefined);
const mockDisconnectAll = vi.fn().mockResolvedValue(undefined);

vi.mock("../src/mcp-bridge.js", () => ({
  MCPBridge: vi.fn().mockImplementation(function () {
    return {
      connect: mockConnect,
      disconnectAll: mockDisconnectAll,
      listServers: vi.fn().mockReturnValue([]),
    };
  }),
}));

vi.mock("../src/mcp-extension.js", () => ({
  createMCPExtension: vi.fn().mockReturnValue({ connect: vi.fn(), disconnect: vi.fn(), listServers: vi.fn() }),
}));

import plugin from "../src/index.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function createMockCtx(config: unknown = {}): any {
  return {
    registerConfigSchema: vi.fn(),
    registerExtension: vi.fn(),
    unregisterExtension: vi.fn(),
    getConfig: vi.fn().mockReturnValue(config),
    registerA2AServer: vi.fn(),
  };
}

describe("wopr-plugin-mcp", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should export name and version", () => {
    expect(plugin.name).toBe("wopr-plugin-mcp");
    expect(plugin.version).toBe("0.1.0");
  });

  it("should register config schema on init", async () => {
    const ctx = createMockCtx();
    await plugin.init!(ctx);

    expect(ctx.registerConfigSchema).toHaveBeenCalledWith("wopr-plugin-mcp", expect.objectContaining({ title: "MCP Bridge" }));
  });

  it("should register mcp extension on init", async () => {
    const ctx = createMockCtx();
    await plugin.init!(ctx);

    expect(ctx.registerExtension).toHaveBeenCalledWith("mcp", expect.anything());
  });

  it("should connect to configured servers on init", async () => {
    const ctx = createMockCtx({
      servers: [
        { name: "gmail", kind: "stdio", cmd: "npx", args: ["-y", "server-gmail"] },
        { name: "linear", kind: "sse", url: "https://mcp.linear.app/sse" },
      ],
    });
    await plugin.init!(ctx);

    expect(mockConnect).toHaveBeenCalledTimes(2);
  });

  it("should handle empty config gracefully", async () => {
    const ctx = createMockCtx(null);
    await plugin.init!(ctx);

    expect(mockConnect).not.toHaveBeenCalled();
  });

  it("should continue connecting other servers if one fails", async () => {
    mockConnect.mockRejectedValueOnce(new Error("connection failed")).mockResolvedValueOnce(undefined);

    const ctx = createMockCtx({
      servers: [
        { name: "broken", kind: "stdio", cmd: "bad" },
        { name: "good", kind: "sse", url: "https://example.com/sse" },
      ],
    });
    await plugin.init!(ctx);

    expect(mockConnect).toHaveBeenCalledTimes(2);
  });

  it("should disconnect all on shutdown", async () => {
    const ctx = createMockCtx();
    await plugin.init!(ctx);
    await plugin.shutdown!();

    expect(mockDisconnectAll).toHaveBeenCalledOnce();
  });
});
