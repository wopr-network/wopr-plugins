import { describe, expect, it, vi } from "vitest";
import { createMCPExtension } from "../src/mcp-extension.js";

const mockCtx = {
  getConfig: () => ({ servers: [] }),
  saveConfig: vi.fn(),
};

describe("createMCPExtension", () => {
  it("should delegate connect to bridge", async () => {
    const bridge = {
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
      listServers: vi.fn().mockReturnValue([]),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    const ext = createMCPExtension(bridge, mockCtx as any);
    await ext.connect({ name: "test", kind: "stdio", cmd: "echo", args: [] });

    expect(bridge.connect).toHaveBeenCalledWith({ name: "test", kind: "stdio", cmd: "echo", args: [] });
  });

  it("should delegate disconnect to bridge", async () => {
    const bridge = {
      connect: vi.fn(),
      disconnect: vi.fn().mockResolvedValue(undefined),
      listServers: vi.fn(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    const ext = createMCPExtension(bridge, mockCtx as any);
    await ext.disconnect("test");

    expect(bridge.disconnect).toHaveBeenCalledWith("test");
  });

  it("should delegate listServers to bridge", () => {
    const bridge = {
      connect: vi.fn(),
      disconnect: vi.fn(),
      listServers: vi.fn().mockReturnValue([{ name: "gmail", kind: "stdio", toolCount: 3 }]),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    const ext = createMCPExtension(bridge, mockCtx as any);
    expect(ext.listServers()).toEqual([{ name: "gmail", kind: "stdio", toolCount: 3 }]);
  });

  it("should persist server config after connect", async () => {
    const savedConfigs: unknown[] = [];
    const ctx = {
      getConfig: () => ({ servers: [] }),
      saveConfig: vi.fn(async (config: unknown) => { savedConfigs.push(config); }),
    };
    const bridge = {
      connect: vi.fn(),
      disconnect: vi.fn(),
      listServers: vi.fn(() => []),
    };
    const ext = createMCPExtension(bridge as any, ctx as any);

    const serverConfig = { name: "test-server", kind: "http" as const, url: "http://localhost:3000" };
    await ext.connect(serverConfig);

    expect(bridge.connect).toHaveBeenCalledWith(serverConfig);
    expect(ctx.saveConfig).toHaveBeenCalledWith({ servers: [serverConfig] });
  });

  it("should remove server from persisted config on disconnect", async () => {
    const existingServer = { name: "keep-me", kind: "http" as const, url: "http://localhost:3001" };
    const removeServer = { name: "remove-me", kind: "http" as const, url: "http://localhost:3002" };
    const ctx = {
      getConfig: () => ({ servers: [existingServer, removeServer] }),
      saveConfig: vi.fn(),
    };
    const bridge = {
      connect: vi.fn(),
      disconnect: vi.fn(),
      listServers: vi.fn(() => []),
    };
    const ext = createMCPExtension(bridge as any, ctx as any);

    await ext.disconnect("remove-me");

    expect(bridge.disconnect).toHaveBeenCalledWith("remove-me");
    expect(ctx.saveConfig).toHaveBeenCalledWith({ servers: [existingServer] });
  });

  it("should not duplicate server configs on reconnect", async () => {
    const existingServer = { name: "my-server", kind: "http" as const, url: "http://localhost:3000" };
    const ctx = {
      getConfig: () => ({ servers: [existingServer] }),
      saveConfig: vi.fn(),
    };
    const bridge = {
      connect: vi.fn(),
      disconnect: vi.fn(),
      listServers: vi.fn(() => []),
    };
    const ext = createMCPExtension(bridge as any, ctx as any);

    await ext.connect(existingServer);

    expect(ctx.saveConfig).toHaveBeenCalledWith({ servers: [existingServer] });
  });
});
