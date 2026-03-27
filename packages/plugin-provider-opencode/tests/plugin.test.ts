import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the @opencode-ai/sdk before importing the plugin
vi.mock("@opencode-ai/sdk", () => ({
  createOpencodeClient: vi.fn(() => ({
    global: {
      health: vi.fn().mockResolvedValue({ data: { healthy: true } }),
    },
    session: {
      create: vi.fn().mockResolvedValue({ data: { id: "test-session-123" } }),
      prompt: vi.fn().mockResolvedValue({
        data: {
          parts: [{ type: "text", text: "Hello from OpenCode" }],
        },
      }),
    },
  })),
}), { virtual: true });

// Mock winston to avoid console noise in tests
vi.mock("winston", () => {
  const mockLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  return {
    default: {
      createLogger: vi.fn(() => mockLogger),
      format: {
        combine: vi.fn(),
        timestamp: vi.fn(),
        errors: vi.fn(),
        json: vi.fn(),
      },
      transports: {
        Console: vi.fn(),
      },
    },
  };
});

describe("wopr-plugin-provider-opencode", () => {
  let plugin: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    // Dynamic import to get fresh module after mocks are set up
    const mod = await import("../src/index.ts");
    plugin = mod.default;
  });

  describe("plugin registration (smoke test)", () => {
    it("should have correct plugin metadata", () => {
      expect(plugin.name).toBe("provider-opencode");
      expect(plugin.version).toBe("1.1.0");
      expect(plugin.description).toContain("OpenCode");
    });

    it("should call registerProvider on init", async () => {
      const ctx = {
        log: { info: vi.fn() },
        registerProvider: vi.fn(),
        unregisterProvider: vi.fn(),
        registerConfigSchema: vi.fn(),
        unregisterConfigSchema: vi.fn(),
      };

      await plugin.init(ctx);

      expect(ctx.registerProvider).toHaveBeenCalledTimes(1);
      const provider = ctx.registerProvider.mock.calls[0][0];
      expect(provider.id).toBe("opencode");
      expect(provider.name).toBe("OpenCode");
    });

    it("should call registerConfigSchema on init", async () => {
      const ctx = {
        log: { info: vi.fn() },
        registerProvider: vi.fn(),
        unregisterProvider: vi.fn(),
        registerConfigSchema: vi.fn(),
        unregisterConfigSchema: vi.fn(),
      };

      await plugin.init(ctx);

      expect(ctx.registerConfigSchema).toHaveBeenCalledTimes(1);
      expect(ctx.registerConfigSchema).toHaveBeenCalledWith(
        "provider-opencode",
        expect.objectContaining({ title: "OpenCode" })
      );
    });

    it("should log messages during init", async () => {
      const ctx = {
        log: { info: vi.fn() },
        registerProvider: vi.fn(),
        unregisterProvider: vi.fn(),
        registerConfigSchema: vi.fn(),
        unregisterConfigSchema: vi.fn(),
      };

      await plugin.init(ctx);

      expect(ctx.log.info).toHaveBeenCalled();
    });

    it("should shutdown without errors", async () => {
      await expect(plugin.shutdown()).resolves.not.toThrow();
    });

    it("should unregister provider and config on shutdown", async () => {
      const ctx = {
        log: { info: vi.fn() },
        registerProvider: vi.fn(),
        unregisterProvider: vi.fn(),
        registerConfigSchema: vi.fn(),
        unregisterConfigSchema: vi.fn(),
      };

      await plugin.init(ctx);
      await plugin.shutdown();

      expect(ctx.unregisterProvider).toHaveBeenCalledWith("opencode");
      expect(ctx.unregisterConfigSchema).toHaveBeenCalledWith("provider-opencode");
    });

    it("should be idempotent on double shutdown", async () => {
      const ctx = {
        log: { info: vi.fn() },
        registerProvider: vi.fn(),
        unregisterProvider: vi.fn(),
        registerConfigSchema: vi.fn(),
        unregisterConfigSchema: vi.fn(),
      };

      await plugin.init(ctx);
      await plugin.shutdown();
      await plugin.shutdown();

      // Second shutdown should not throw, cleanups already drained
      expect(ctx.unregisterProvider).toHaveBeenCalledTimes(1);
    });
  });

  describe("config validation", () => {
    it("should register config with required fields", async () => {
      const ctx = {
        log: { info: vi.fn() },
        registerProvider: vi.fn(),
        unregisterProvider: vi.fn(),
        registerConfigSchema: vi.fn(),
        unregisterConfigSchema: vi.fn(),
      };

      await plugin.init(ctx);

      const schema = ctx.registerConfigSchema.mock.calls[0][1];
      expect(schema.title).toBe("OpenCode");
      expect(schema.description).toContain("OpenCode");
      expect(schema.fields).toBeInstanceOf(Array);
      expect(schema.fields.length).toBeGreaterThan(0);
    });

    it("should have a serverUrl field marked as required", async () => {
      const ctx = {
        log: { info: vi.fn() },
        registerProvider: vi.fn(),
        unregisterProvider: vi.fn(),
        registerConfigSchema: vi.fn(),
        unregisterConfigSchema: vi.fn(),
      };

      await plugin.init(ctx);

      const schema = ctx.registerConfigSchema.mock.calls[0][1];
      const serverUrlField = schema.fields.find(
        (f: any) => f.name === "serverUrl"
      );
      expect(serverUrlField).toBeDefined();
      expect(serverUrlField.type).toBe("text");
      expect(serverUrlField.required).toBe(true);
      expect(serverUrlField.default).toBe("http://localhost:4096");
    });

    it("should have a model select field with supported models", async () => {
      const ctx = {
        log: { info: vi.fn() },
        registerProvider: vi.fn(),
        unregisterProvider: vi.fn(),
        registerConfigSchema: vi.fn(),
        unregisterConfigSchema: vi.fn(),
      };

      await plugin.init(ctx);

      const schema = ctx.registerConfigSchema.mock.calls[0][1];
      const modelField = schema.fields.find((f: any) => f.name === "model");
      expect(modelField).toBeDefined();
      expect(modelField.type).toBe("select");
      expect(modelField.options).toBeInstanceOf(Array);
      expect(modelField.options.length).toBe(4);

      const values = modelField.options.map((o: any) => o.value);
      expect(values).toContain("claude-3-5-sonnet");
      expect(values).toContain("gpt-4o");
    });
  });

  describe("provider interface (mock-based)", () => {
    let provider: any;

    beforeEach(async () => {
      const ctx = {
        log: { info: vi.fn() },
        registerProvider: vi.fn(),
        unregisterProvider: vi.fn(),
        registerConfigSchema: vi.fn(),
        unregisterConfigSchema: vi.fn(),
      };

      await plugin.init(ctx);
      provider = ctx.registerProvider.mock.calls[0][0];
    });

    it("should have correct provider properties", () => {
      expect(provider.id).toBe("opencode");
      expect(provider.name).toBe("OpenCode");
      expect(provider.description).toContain("A2A");
      expect(provider.defaultModel).toBe("claude-3-5-sonnet");
      expect(provider.supportedModels).toContain("claude-3-5-sonnet");
      expect(provider.supportedModels).toContain("gpt-4o");
      expect(provider.supportedModels).toContain("gpt-4o-mini");
      expect(provider.supportedModels).toContain("claude-3-5-haiku");
    });

    it("should return custom credential type", () => {
      expect(provider.getCredentialType()).toBe("custom");
    });

    it("should validate credentials via health check", async () => {
      const result = await provider.validateCredentials(
        "http://localhost:4096"
      );
      expect(result).toBe(true);
    });

    it("should create a client", async () => {
      const client = await provider.createClient("http://localhost:4096");
      expect(client).toBeDefined();
      expect(typeof client.query).toBe("function");
      expect(typeof client.listModels).toBe("function");
      expect(typeof client.healthCheck).toBe("function");
    });

    it("should list supported models from client", async () => {
      const client = await provider.createClient("http://localhost:4096");
      const models = await client.listModels();
      expect(models).toEqual(provider.supportedModels);
    });

    it("should perform health check from client", async () => {
      const client = await provider.createClient("http://localhost:4096");
      const healthy = await client.healthCheck();
      expect(healthy).toBe(true);
    });

    it("should yield events from query", async () => {
      const client = await provider.createClient("http://localhost:4096");
      const events: any[] = [];

      for await (const event of client.query({ prompt: "Hello" })) {
        events.push(event);
      }

      // Should have init event, assistant message, and result
      expect(events.length).toBeGreaterThanOrEqual(2);

      const initEvent = events.find(
        (e) => e.type === "system" && e.subtype === "init"
      );
      expect(initEvent).toBeDefined();
      expect(initEvent.session_id).toBe("test-session-123");

      const textEvent = events.find((e) => e.type === "assistant");
      expect(textEvent).toBeDefined();
      expect(textEvent.message.content[0].text).toBe("Hello from OpenCode");

      const resultEvent = events.find((e) => e.type === "result");
      expect(resultEvent).toBeDefined();
      expect(resultEvent.subtype).toBe("success");
    });
  });
});
