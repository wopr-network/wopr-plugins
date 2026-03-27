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

vi.mock("fs", () => ({
  existsSync: vi.fn(() => false),
}));

describe("config validation", () => {
  let configSchema: any;

  beforeEach(async () => {
    const mod = await import("../src/index.js");
    const plugin = mod.default;

    const ctx = {
      log: { info: vi.fn() },
      registerProvider: vi.fn(),
      registerConfigSchema: vi.fn(),
      unregisterExtension: vi.fn(),
      unregisterConfigSchema: vi.fn(),
    };

    await plugin.init(ctx);

    // Extract the config schema from the registerConfigSchema call
    const schemaName = ctx.registerConfigSchema.mock.calls[0][0];
    configSchema = ctx.registerConfigSchema.mock.calls[0][1];

    expect(schemaName).toBe("provider-kimi");
  });

  it("has a title and description", () => {
    expect(configSchema.title).toBe("Kimi");
    expect(configSchema.description).toContain("Kimi");
  });

  it("has fields array", () => {
    expect(Array.isArray(configSchema.fields)).toBe(true);
    expect(configSchema.fields.length).toBeGreaterThan(0);
  });

  it("includes kimiPath field", () => {
    const kimiPathField = configSchema.fields.find(
      (f: any) => f.name === "kimiPath"
    );
    expect(kimiPathField).toBeDefined();
    expect(kimiPathField.type).toBe("text");
    expect(kimiPathField.label).toBe("Kimi CLI Path");
    expect(kimiPathField.required).toBe(false);
  });

  it("kimiPath field has a placeholder", () => {
    const kimiPathField = configSchema.fields.find(
      (f: any) => f.name === "kimiPath"
    );
    expect(kimiPathField.placeholder).toBeDefined();
    expect(typeof kimiPathField.placeholder).toBe("string");
  });

  it("kimiPath field has a description", () => {
    const kimiPathField = configSchema.fields.find(
      (f: any) => f.name === "kimiPath"
    );
    expect(kimiPathField.description).toBeDefined();
    expect(kimiPathField.description).toContain("Kimi CLI");
  });

  it("all fields have required name, type, and label", () => {
    for (const field of configSchema.fields) {
      expect(field.name).toBeDefined();
      expect(typeof field.name).toBe("string");
      expect(field.type).toBeDefined();
      expect(typeof field.type).toBe("string");
      expect(field.label).toBeDefined();
      expect(typeof field.label).toBe("string");
    }
  });
});
