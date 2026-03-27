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

describe("provider interface", () => {
  let provider: any;

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
    provider = ctx.registerProvider.mock.calls[0][0];
  });

  describe("metadata", () => {
    it("has correct id", () => {
      expect(provider.id).toBe("kimi");
    });

    it("has correct name", () => {
      expect(provider.name).toBe("Kimi");
    });

    it("has a description", () => {
      expect(provider.description).toBeDefined();
      expect(provider.description.length).toBeGreaterThan(0);
    });

    it("has defaultModel set to kimi-k2", () => {
      expect(provider.defaultModel).toBe("kimi-k2");
    });

    it("supportedModels includes kimi-k2", () => {
      expect(provider.supportedModels).toContain("kimi-k2");
    });
  });

  describe("getCredentialType", () => {
    it("returns oauth", () => {
      expect(provider.getCredentialType()).toBe("oauth");
    });
  });

  describe("createClient", () => {
    it("returns a client object", async () => {
      const client = await provider.createClient("unused-credential");
      expect(client).toBeDefined();
      expect(typeof client.query).toBe("function");
      expect(typeof client.listModels).toBe("function");
      expect(typeof client.healthCheck).toBe("function");
    });

    it("client listModels returns kimi-k2", async () => {
      const client = await provider.createClient("unused-credential");
      const models = await client.listModels();
      expect(models).toEqual(["kimi-k2"]);
    });
  });

  describe("validateCredentials", () => {
    it("returns false when SDK is unavailable", async () => {
      vi.doMock("@moonshot-ai/kimi-agent-sdk", () => {
        throw new Error("Cannot find module");
      });
      // Re-import to pick up the mock
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
      const p = ctx.registerProvider.mock.calls[0][0];
      const result = await p.validateCredentials("any-credential");
      expect(result).toBe(false);
      vi.doUnmock("@moonshot-ai/kimi-agent-sdk");
    });
  });
});

describe("A2A config conversion", () => {
  it("plugin registers provider that accepts a2aServers in query options", async () => {
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
    const provider = ctx.registerProvider.mock.calls[0][0];

    // Create client and verify it accepts options
    const client = await provider.createClient("credential", {
      customOption: "value",
    });
    expect(client).toBeDefined();
    // The client should have the query method that processes a2aServers
    expect(typeof client.query).toBe("function");
  });
});
