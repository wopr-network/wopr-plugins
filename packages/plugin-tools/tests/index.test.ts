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
    expect(plugin.version).toBe("2.0.0");
    expect(typeof plugin.description).toBe("string");
  });

  it("has a manifest with required fields", async () => {
    const plugin = (activePlugin = await loadPlugin());
    expect(plugin.manifest).toBeDefined();
    expect(plugin.manifest!.capabilities).toEqual(["a2a"]);
    expect(plugin.manifest!.dependencies).toEqual(["wopr-plugin-http", "wopr-plugin-exec"]);
  });

  it("init logs initialization messages", async () => {
    const plugin = (activePlugin = await loadPlugin());
    const ctx = makeMockContext();
    await plugin.init!(ctx as any);
    expect(ctx.log.info).toHaveBeenCalledWith("Tools meta-package initialized");
    expect(ctx.log.info).toHaveBeenCalledWith("Dependencies: wopr-plugin-http, wopr-plugin-exec");
  });

  it("shutdown is safe to call even without init", async () => {
    const plugin = (activePlugin = await loadPlugin());
    // shutdown may be undefined on this meta-package, which is fine
    if (plugin.shutdown) {
      await expect(plugin.shutdown()).resolves.not.toThrow();
    }
  });

  it("init does not throw when registerA2AServer is not available", async () => {
    const plugin = (activePlugin = await loadPlugin());
    const ctx = makeMockContext();
    (ctx as any).registerA2AServer = undefined;
    await expect(plugin.init!(ctx as any)).resolves.not.toThrow();
  });

  it("manifest name matches plugin name", async () => {
    const plugin = (activePlugin = await loadPlugin());
    expect(plugin.manifest!.name).toBe("wopr-plugin-tools");
    expect(plugin.manifest!.version).toBe("2.0.0");
  });

  it("manifest has description", async () => {
    const plugin = (activePlugin = await loadPlugin());
    expect(plugin.manifest!.description).toBeDefined();
    expect(typeof plugin.manifest!.description).toBe("string");
  });
});
