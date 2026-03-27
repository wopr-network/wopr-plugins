import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock winston before importing plugin
vi.mock("winston", () => {
  const format = {
    combine: vi.fn(),
    timestamp: vi.fn(),
    errors: vi.fn(),
    json: vi.fn(),
    colorize: vi.fn(),
    simple: vi.fn(),
  };
  return {
    default: {
      createLogger: vi.fn(() => ({
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      })),
      format,
      transports: { Console: vi.fn() },
    },
  };
});

// Mock fs to avoid filesystem access
vi.mock("fs", () => ({
  existsSync: vi.fn(() => false),
}));

describe("plugin smoke test", () => {
  let plugin: any;

  beforeEach(async () => {
    const mod = await import("../src/index.js");
    plugin = mod.default;
  });

  it("exports a valid plugin object", () => {
    expect(plugin).toBeDefined();
    expect(plugin.name).toBe("provider-kimi");
    expect(plugin.version).toBe("1.6.0");
    expect(plugin.description).toContain("Kimi");
  });

  it("has init and shutdown methods", () => {
    expect(typeof plugin.init).toBe("function");
    expect(typeof plugin.shutdown).toBe("function");
  });

  it("init calls registerProvider and registerConfigSchema", async () => {
    const ctx = {
      log: { info: vi.fn() },
      registerProvider: vi.fn(),
      registerConfigSchema: vi.fn(),
      unregisterExtension: vi.fn(),
      unregisterConfigSchema: vi.fn(),
    };

    await plugin.init(ctx);

    expect(ctx.registerProvider).toHaveBeenCalledTimes(1);
    expect(ctx.registerConfigSchema).toHaveBeenCalledTimes(1);
    expect(ctx.log.info).toHaveBeenCalled();
  });

  it("init registers provider with id 'kimi'", async () => {
    const ctx = {
      log: { info: vi.fn() },
      registerProvider: vi.fn(),
      registerConfigSchema: vi.fn(),
      unregisterExtension: vi.fn(),
      unregisterConfigSchema: vi.fn(),
    };

    await plugin.init(ctx);

    const provider = ctx.registerProvider.mock.calls[0][0];
    expect(provider.id).toBe("kimi");
    expect(provider.name).toBe("Kimi");
  });

  it("shutdown completes without error", async () => {
    await expect(plugin.shutdown()).resolves.toBeUndefined();
  });
});
