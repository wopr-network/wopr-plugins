import { vi, describe, it, expect, beforeEach } from "vitest";
import plugin from "../src/index.js";

function createMockCtx() {
  return {
    registerExtension: vi.fn(),
    unregisterExtension: vi.fn(),
    registerA2AServer: vi.fn(),
    getSessions: vi.fn(() => []),
    hooks: { on: vi.fn(() => vi.fn()) },
    events: { emitCustom: vi.fn() },
    log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  };
}

describe("wopr-plugin-canvas plugin", () => {
  let mockCtx: ReturnType<typeof createMockCtx>;

  beforeEach(() => {
    mockCtx = createMockCtx();
  });

  it("has correct plugin metadata", () => {
    expect(plugin.name).toBe("@wopr-network/wopr-plugin-canvas");
    expect(plugin.version).toBe("1.0.0");
    expect(plugin.description).toContain("Canvas");
  });

  it("registers canvas:router extension on init", async () => {
    await plugin.init(mockCtx as any);
    const routerCall = mockCtx.registerExtension.mock.calls.find(
      (c: any[]) => c[0] === "canvas:router",
    );
    expect(routerCall).toBeDefined();
    expect(routerCall![1]).toBeDefined();
  });

  it("registers canvas:setPublish extension on init", async () => {
    await plugin.init(mockCtx as any);
    const publishCall = mockCtx.registerExtension.mock.calls.find(
      (c: any[]) => c[0] === "canvas:setPublish",
    );
    expect(publishCall).toBeDefined();
    expect(typeof publishCall![1]).toBe("function");
  });

  it("registers A2A servers for active sessions", async () => {
    mockCtx.getSessions.mockReturnValue(["session-1", "session-2"]);
    await plugin.init(mockCtx as any);
    expect(mockCtx.registerA2AServer).toHaveBeenCalledTimes(2);
  });

  it("registers session:create hook for future sessions", async () => {
    await plugin.init(mockCtx as any);
    expect(mockCtx.hooks.on).toHaveBeenCalledWith(
      "session:create",
      expect.any(Function),
    );
  });

  it("registers A2A server when session:create fires", async () => {
    await plugin.init(mockCtx as any);
    const hookCallback = mockCtx.hooks.on.mock.calls.find(
      (c: any[]) => c[0] === "session:create",
    )![1] as Function;

    hookCallback({ session: "new-session" });
    // 0 active sessions + 1 from hook = 1
    expect(mockCtx.registerA2AServer).toHaveBeenCalledTimes(1);
  });

  it("skips A2A registration when registerA2AServer is not available", async () => {
    const ctx = { ...mockCtx, registerA2AServer: undefined };
    // Should not throw
    await plugin.init(ctx as any);
    expect(mockCtx.registerExtension).toHaveBeenCalled();
  });

  it("logs info on init", async () => {
    await plugin.init(mockCtx as any);
    expect(mockCtx.log.info).toHaveBeenCalledWith("Canvas plugin initialized");
  });

  it("shutdown completes without error", async () => {
    await plugin.init(mockCtx as any);
    await expect(plugin.shutdown!()).resolves.toBeUndefined();
  });

  it("has a manifest with required fields", () => {
    expect(plugin.manifest).toBeDefined();
    expect(plugin.manifest!.name).toBe("@wopr-network/wopr-plugin-canvas");
    expect(plugin.manifest!.capabilities).toContain("canvas");
    expect(plugin.manifest!.category).toBe("workspace");
    expect(plugin.manifest!.tags).toContain("canvas");
    expect(plugin.manifest!.icon).toBe(":art:");
    expect(plugin.manifest!.lifecycle).toBeDefined();
  });

  it("shutdown unregisters extensions", async () => {
    await plugin.init(mockCtx as any);
    await plugin.shutdown!();
    expect(mockCtx.unregisterExtension).toHaveBeenCalledWith("canvas:router");
    expect(mockCtx.unregisterExtension).toHaveBeenCalledWith("canvas:setPublish");
  });

  it("shutdown is idempotent (safe to call twice)", async () => {
    await plugin.init(mockCtx as any);
    await plugin.shutdown!();
    await expect(plugin.shutdown!()).resolves.toBeUndefined();
  });
});
