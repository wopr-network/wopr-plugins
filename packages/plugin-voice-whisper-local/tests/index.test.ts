import type { WOPRPluginContext } from "@wopr-network/plugin-types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function mockContext(overrides: Partial<WOPRPluginContext> = {}): WOPRPluginContext {
  return {
    inject: vi.fn().mockResolvedValue(""),
    logMessage: vi.fn(),
    getAgentIdentity: vi.fn().mockReturnValue({}),
    getUserProfile: vi.fn().mockReturnValue({}),
    getSessions: vi.fn().mockReturnValue([]),
    cancelInject: vi.fn().mockReturnValue(false),
    events: {
      on: vi.fn(),
      off: vi.fn(),
      emit: vi.fn().mockResolvedValue(undefined),
    } as unknown as WOPRPluginContext["events"],
    hooks: { register: vi.fn(), unregister: vi.fn(), run: vi.fn() } as unknown as WOPRPluginContext["hooks"],
    registerContextProvider: vi.fn(),
    unregisterContextProvider: vi.fn(),
    getContextProvider: vi.fn(),
    registerChannel: vi.fn(),
    unregisterChannel: vi.fn(),
    getChannel: vi.fn(),
    getChannels: vi.fn().mockReturnValue([]),
    getChannelsForSession: vi.fn().mockReturnValue([]),
    registerWebUiExtension: vi.fn(),
    unregisterWebUiExtension: vi.fn(),
    getWebUiExtensions: vi.fn().mockReturnValue([]),
    registerUiComponent: vi.fn(),
    unregisterUiComponent: vi.fn(),
    getUiComponents: vi.fn().mockReturnValue([]),
    getConfig: vi.fn().mockReturnValue({}),
    saveConfig: vi.fn().mockResolvedValue(undefined),
    getMainConfig: vi.fn(),
    registerLLMProvider: vi.fn(),
    unregisterLLMProvider: vi.fn(),
    getProvider: vi.fn(),
    registerConfigSchema: vi.fn(),
    unregisterConfigSchema: vi.fn(),
    getConfigSchema: vi.fn(),
    registerExtension: vi.fn(),
    unregisterExtension: vi.fn(),
    getExtension: vi.fn(),
    listExtensions: vi.fn().mockReturnValue([]),
    registerSTTProvider: vi.fn(),
    registerTTSProvider: vi.fn(),
    getSTT: vi.fn(),
    getTTS: vi.fn(),
    hasVoice: vi.fn().mockReturnValue({ stt: false, tts: false }),
    registerChannelProvider: vi.fn(),
    unregisterChannelProvider: vi.fn(),
    getChannelProvider: vi.fn(),
    getChannelProviders: vi.fn().mockReturnValue([]),
    log: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
    storage: { define: vi.fn(), getRepository: vi.fn() } as unknown as WOPRPluginContext["storage"],
    getPluginDir: vi.fn().mockReturnValue("/tmp/test-plugin"),
    ...overrides,
  } as WOPRPluginContext;
}

describe("voice-whisper-local plugin", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let plugin: any;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import("../src/index.js");
    plugin = mod.default;
  });

  afterEach(async () => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      await plugin.shutdown?.();
    } catch {
      // Ignore
    }
  });

  it("exports a default WOPRPlugin object", () => {
    expect(plugin).toBeDefined();
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    expect(plugin.name).toBe("voice-whisper-local");
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    expect(plugin.version).toBe("1.0.0");
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    expect(typeof plugin.init).toBe("function");
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    expect(typeof plugin.shutdown).toBe("function");
  });

  it("has a complete manifest with required fields", () => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    expect(plugin.manifest).toBeDefined();
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    expect(plugin.manifest.capabilities).toContain("stt");
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    expect(plugin.manifest.category).toBe("voice");
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    expect(plugin.manifest.tags).toEqual(expect.arrayContaining(["stt", "whisper", "docker"]));
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    expect(plugin.manifest.icon).toBeDefined();
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    expect(plugin.manifest.requires).toBeDefined();
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    expect(plugin.manifest.requires.docker).toEqual(["fedirz/faster-whisper-server:latest"]);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    expect(plugin.manifest.provides).toBeDefined();
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    expect(plugin.manifest.provides.capabilities).toHaveLength(1);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    expect(plugin.manifest.provides.capabilities[0].type).toBe("stt");
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    expect(plugin.manifest.lifecycle).toBeDefined();
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    expect(plugin.manifest.configSchema).toBeDefined();
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    expect(plugin.manifest.configSchema.fields.length).toBeGreaterThan(0);
  });

  it("init() saves ctx and registers config schema", async () => {
    const ctx = mockContext();
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    await plugin.init(ctx);
    expect(ctx.registerConfigSchema).toHaveBeenCalledWith(
      "voice-whisper-local",
      expect.objectContaining({ title: expect.any(String), fields: expect.any(Array) }),
    );
  });

  it("init() registers STT provider", async () => {
    const ctx = mockContext();
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    await plugin.init(ctx);
    expect(ctx.registerSTTProvider).toHaveBeenCalledTimes(1);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const provider = (ctx.registerSTTProvider as ReturnType<typeof vi.fn>).mock.calls[0][0];
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    expect(provider.metadata.name).toBe("whisper-local");
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    expect(provider.metadata.type).toBe("stt");
  });

  it("init() logs success", async () => {
    const ctx = mockContext();
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    await plugin.init(ctx);
    expect(ctx.log.info).toHaveBeenCalledWith(expect.stringContaining("Whisper Local"));
  });

  it("init() throws on invalid config", async () => {
    const ctx = mockContext({
      getConfig: vi.fn().mockReturnValue({ model: "invalid-model" }),
    });
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    await expect(plugin.init(ctx)).rejects.toThrow("Invalid model");
  });

  it("shutdown() runs cleanups in LIFO order", async () => {
    const ctx = mockContext();
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    await plugin.init(ctx);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    await expect(plugin.shutdown()).resolves.toBeUndefined();
    expect(ctx.unregisterConfigSchema).toHaveBeenCalledWith("voice-whisper-local");
  });

  it("shutdown() is safe to call without init", async () => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    await expect(plugin.shutdown()).resolves.toBeUndefined();
  });

  it("shutdown() resets state — double init/shutdown works", async () => {
    const ctx1 = mockContext();
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    await plugin.init(ctx1);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    await plugin.shutdown();

    const ctx2 = mockContext();
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    await plugin.init(ctx2);
    expect(ctx2.registerSTTProvider).toHaveBeenCalledTimes(1);
    expect(ctx2.registerConfigSchema).toHaveBeenCalledTimes(1);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    await plugin.shutdown();
    expect(ctx2.unregisterConfigSchema).toHaveBeenCalled();
  });

  it("init() with default config does not throw", async () => {
    const ctx = mockContext({
      getConfig: vi.fn().mockReturnValue({}),
    });
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    await expect(plugin.init(ctx)).resolves.toBeUndefined();
  });

  it("manifest has correct lifecycle settings", () => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    expect(plugin.manifest.lifecycle.shutdownBehavior).toBe("graceful");
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    expect(plugin.manifest.lifecycle.shutdownTimeoutMs).toBe(15000);
  });
});
