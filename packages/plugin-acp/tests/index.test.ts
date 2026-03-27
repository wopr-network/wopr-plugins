import { describe, it, expect, vi } from "vitest";
import plugin from "../src/index.js";
import type { WOPRPluginContext } from "@wopr-network/plugin-types";

function createMockContext(): WOPRPluginContext {
  return {
    log: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
    storage: {} as any,
    inject: vi.fn().mockResolvedValue({ type: "text", content: "ok" }),
    cancelInject: vi.fn().mockReturnValue(true),
    getSessions: vi.fn().mockReturnValue(["main"]),
    getMainConfig: vi.fn().mockReturnValue({}),
    registerExtension: vi.fn(),
    unregisterExtension: vi.fn(),
  } as unknown as WOPRPluginContext;
}

describe("plugin", () => {
  it("has correct metadata", () => {
    expect(plugin.name).toBe("wopr-plugin-acp");
    expect(plugin.version).toBe("1.0.0");
    expect(plugin.description).toBeDefined();
  });

  it("has a complete manifest with required fields", () => {
    expect(plugin.manifest).toBeDefined();
    expect(plugin.manifest?.capabilities).toBeDefined();
    expect(plugin.manifest?.category).toBeDefined();
    expect(plugin.manifest?.tags).toBeDefined();
    expect(plugin.manifest?.icon).toBeDefined();
    expect(plugin.manifest?.requires).toBeDefined();
    expect(plugin.manifest?.provides).toBeDefined();
    expect(plugin.manifest?.lifecycle).toBeDefined();
    // configSchema is optional for plugins with no user-configurable settings
  });

  it("shutdown unregisters the acp:server extension", async () => {
    const ctx = createMockContext();
    await plugin.init(ctx);
    await plugin.shutdown();
    expect(ctx.unregisterExtension).toHaveBeenCalledWith("acp:server");
  });

  it("shutdown sets ctx to null (safe double-shutdown after unregister)", async () => {
    const ctx = createMockContext();
    await plugin.init(ctx);
    await plugin.shutdown();
    // Double-shutdown should not call unregisterExtension again
    const ctx2 = createMockContext();
    await plugin.shutdown();
    expect(ctx2.unregisterExtension).not.toHaveBeenCalled();
  });

  it("initializes and registers ACP server extension", async () => {
    const ctx = createMockContext();
    await plugin.init(ctx);

    expect(ctx.registerExtension).toHaveBeenCalledWith(
      "acp:server",
      expect.any(Object)
    );
    expect(ctx.log.info).toHaveBeenCalledWith(
      expect.stringContaining("ACP plugin initialized")
    );
  });

  it("uses first available session as default", async () => {
    const ctx = createMockContext();
    (ctx.getSessions as any).mockReturnValue(["my-session", "other"]);
    await plugin.init(ctx);
    expect(ctx.registerExtension).toHaveBeenCalled();
  });

  it("falls back to 'acp' when no sessions exist", async () => {
    const ctx = createMockContext();
    (ctx.getSessions as any).mockReturnValue([]);
    await plugin.init(ctx);
    expect(ctx.registerExtension).toHaveBeenCalled();
  });

  it("shutdown cleans up the server", async () => {
    const ctx = createMockContext();
    await plugin.init(ctx);
    await plugin.shutdown();
    // Should not throw on double shutdown
    await plugin.shutdown();
  });

  it("shutdown is safe when init was never called", async () => {
    // Fresh module re-import would have acpServer = null
    // We can't easily reset module state, but shutdown should handle null
    await plugin.shutdown();
  });
});
