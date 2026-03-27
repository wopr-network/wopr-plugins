import { afterEach, describe, expect, it, vi } from "vitest";
import type { WOPRPlugin } from "../src/types.js";

// Dynamic import so module-level state resets per test file
async function loadPlugin(): Promise<WOPRPlugin> {
  const mod = await import("../src/index.js");
  return mod.default;
}

function makeMockContext() {
  return {
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    getConfig: vi.fn().mockReturnValue({}),
    registerConfigSchema: vi.fn(),
    unregisterConfigSchema: vi.fn(),
    registerA2AServer: vi.fn(),
  };
}

describe("wopr-plugin-tools lifecycle", () => {
  let activePlugin: WOPRPlugin | null = null;

  afterEach(async () => {
    await activePlugin?.shutdown?.();
    activePlugin = null;
  });

  it("exports a valid WOPRPlugin with name, version, description", async () => {
    const plugin = (activePlugin = await loadPlugin());
    expect(plugin.name).toBe("wopr-plugin-tools");
    expect(plugin.version).toBe("1.0.0");
    expect(typeof plugin.description).toBe("string");
  });

  it("has a manifest with required fields", async () => {
    const plugin = (activePlugin = await loadPlugin());
    expect(plugin.manifest).toBeDefined();
    expect(plugin.manifest!.capabilities).toEqual(["http_fetch", "exec_command"]);
    expect(plugin.manifest!.category).toBe("tools");
    expect(plugin.manifest!.tags).toEqual(expect.arrayContaining(["http", "exec"]));
    expect(plugin.manifest!.icon).toBe("wrench");
    expect(plugin.manifest!.configSchema).toBeDefined();
    expect(plugin.manifest!.lifecycle).toBeDefined();
  });

  it("init registers config schema and A2A server", async () => {
    const plugin = (activePlugin = await loadPlugin());
    const ctx = makeMockContext();
    await plugin.init!(ctx as any);
    expect(ctx.registerConfigSchema).toHaveBeenCalledWith("wopr-plugin-tools", expect.any(Object));
    expect(ctx.registerA2AServer).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "wopr-plugin-tools",
        tools: expect.arrayContaining([
          expect.objectContaining({ name: "http_fetch" }),
          expect.objectContaining({ name: "exec_command" }),
        ]),
      }),
    );
  });

  it("shutdown unregisters config schema", async () => {
    const plugin = (activePlugin = await loadPlugin());
    const ctx = makeMockContext();
    await plugin.init!(ctx as any);
    await plugin.shutdown!();
    expect(ctx.unregisterConfigSchema).toHaveBeenCalledWith("wopr-plugin-tools");
  });

  it("shutdown is idempotent — calling twice does not throw", async () => {
    const plugin = (activePlugin = await loadPlugin());
    const ctx = makeMockContext();
    await plugin.init!(ctx as any);
    await plugin.shutdown!();
    await expect(plugin.shutdown!()).resolves.not.toThrow();
  });

  it("init logs error when registerA2AServer is not available", async () => {
    const plugin = (activePlugin = await loadPlugin());
    const ctx = makeMockContext();
    (ctx as any).registerA2AServer = undefined;
    await plugin.init!(ctx as any);
    expect(ctx.log.error).toHaveBeenCalledWith(expect.stringContaining("registerA2AServer not available"));
  });

  it("config fields have setupFlow set", async () => {
    const plugin = (activePlugin = await loadPlugin());
    const fields = plugin.manifest!.configSchema!.fields;
    for (const field of fields) {
      expect(field.setupFlow).toBeDefined();
    }
  });
});
