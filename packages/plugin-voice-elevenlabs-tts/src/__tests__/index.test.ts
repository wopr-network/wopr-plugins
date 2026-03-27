import type { WOPRPluginContext } from "@wopr-network/plugin-types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock node-fetch before any imports
vi.mock("node-fetch", () => ({
	default: vi.fn(),
}));

function makeMockCtx(
	overrides: Partial<WOPRPluginContext> = {},
): WOPRPluginContext {
	return {
		log: {
			info: vi.fn(),
			warn: vi.fn(),
			error: vi.fn(),
			debug: vi.fn(),
		},
		registerExtension: vi.fn(),
		unregisterExtension: vi.fn(),
		registerConfigSchema: vi.fn(),
		unregisterConfigSchema: vi.fn(),
		getConfigSchema: vi.fn().mockReturnValue(undefined),
		getExtension: vi.fn(),
		inject: vi.fn(),
		logMessage: vi.fn(),
		getAgentIdentity: vi.fn(),
		getUserProfile: vi.fn(),
		getSessions: vi.fn().mockReturnValue([]),
		cancelInject: vi.fn(),
		events: {} as WOPRPluginContext["events"],
		hooks: {} as WOPRPluginContext["hooks"],
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
		saveConfig: vi.fn(),
		getMainConfig: vi.fn(),
		registerProvider: vi.fn(),
		unregisterProvider: vi.fn(),
		getProvider: vi.fn(),
		registerCapabilityProvider: vi.fn(),
		unregisterCapabilityProvider: vi.fn(),
		getCapabilityProviders: vi.fn().mockReturnValue([]),
		hasCapability: vi.fn().mockReturnValue(false),
		registerHealthProbe: vi.fn(),
		registerSetupContextProvider: vi.fn(),
		unregisterSetupContextProvider: vi.fn(),
		registerChannelProvider: vi.fn(),
		unregisterChannelProvider: vi.fn(),
		getChannelProvider: vi.fn(),
		getChannelProviders: vi.fn().mockReturnValue([]),
		storage: {} as WOPRPluginContext["storage"],
		getPluginDir: vi.fn().mockReturnValue("/tmp"),
		listExtensions: vi.fn().mockReturnValue([]),
		...overrides,
	};
}

describe("plugin lifecycle", () => {
	beforeEach(() => {
		process.env.ELEVENLABS_API_KEY = "test-key-123";
		vi.resetModules();
	});

	afterEach(() => {
		delete process.env.ELEVENLABS_API_KEY;
	});

	it("init stores ctx and registers extension", async () => {
		const { default: plugin } = await import("../index.js");
		const registerExtension = vi.fn();
		const mockCtx = makeMockCtx({ registerExtension });

		await plugin.init?.(mockCtx);
		expect(registerExtension).toHaveBeenCalledWith("tts", expect.any(Object));

		await plugin.shutdown?.();
	});

	it("init calls registerExtension with the TTS provider", async () => {
		const { default: plugin, ElevenLabsTTSProvider } = await import(
			"../index.js"
		);
		const registerExtension = vi.fn();
		const mockCtx = makeMockCtx({ registerExtension });

		await plugin.init?.(mockCtx);
		expect(registerExtension).toHaveBeenCalledWith(
			"tts",
			expect.any(ElevenLabsTTSProvider),
		);

		await plugin.shutdown?.();
	});

	it("init registers capability provider when available", async () => {
		const { default: plugin } = await import("../index.js");
		const registerCapabilityProvider = vi.fn();
		const mockCtx = makeMockCtx({
			registerCapabilityProvider,
		} as unknown as Partial<WOPRPluginContext>);

		await plugin.init?.(mockCtx);
		expect(registerCapabilityProvider).toHaveBeenCalledWith(
			"tts",
			expect.objectContaining({ id: "elevenlabs" }),
		);

		await plugin.shutdown?.();
	});

	it("init registers config schema", async () => {
		const { default: plugin } = await import("../index.js");
		const registerConfigSchema = vi.fn();
		const mockCtx = makeMockCtx({ registerConfigSchema });

		await plugin.init?.(mockCtx);
		expect(registerConfigSchema).toHaveBeenCalledWith(
			"voice-elevenlabs-tts",
			expect.objectContaining({
				title: expect.any(String),
				fields: expect.arrayContaining([
					expect.objectContaining({ name: "apiKey", secret: true }),
				]),
			}),
		);

		await plugin.shutdown?.();
	});

	it("shutdown calls unregisterExtension to reverse registration", async () => {
		const { default: plugin } = await import("../index.js");
		const unregisterExtension = vi.fn();
		const mockCtx = makeMockCtx({ unregisterExtension });

		await plugin.init?.(mockCtx);
		await plugin.shutdown?.();

		expect(unregisterExtension).toHaveBeenCalledWith("tts");
	});

	it("shutdown calls unregisterConfigSchema", async () => {
		const { default: plugin } = await import("../index.js");
		const unregisterConfigSchema = vi.fn();
		const mockCtx = makeMockCtx({ unregisterConfigSchema });

		await plugin.init?.(mockCtx);
		await plugin.shutdown?.();

		expect(unregisterConfigSchema).toHaveBeenCalledWith("voice-elevenlabs-tts");
	});

	it("shutdown sets ctx to null (idempotent second call)", async () => {
		const { default: plugin } = await import("../index.js");
		const mockCtx = makeMockCtx();

		await plugin.init?.(mockCtx);
		await plugin.shutdown?.();
		// Second call should not throw even with no active context
		await expect(plugin.shutdown?.()).resolves.toBeUndefined();
	});

	it("plugin has manifest with provides.capabilities", async () => {
		const { default: plugin } = await import("../index.js");
		expect(plugin.manifest).toBeDefined();
		expect(plugin.manifest?.provides?.capabilities).toContainEqual(
			expect.objectContaining({ type: "tts", id: "elevenlabs" }),
		);
	});

	it("plugin manifest has configSchema with apiKey marked secret", async () => {
		const { default: plugin } = await import("../index.js");
		const schema = plugin.manifest?.configSchema;
		expect(schema).toBeDefined();
		const apiKeyField = schema?.fields.find((f) => f.name === "apiKey");
		expect(apiKeyField).toBeDefined();
		expect(apiKeyField?.secret).toBe(true);
		expect(apiKeyField?.setupFlow).toBe("paste");
	});
});

describe("ElevenLabsTTSProvider", () => {
	beforeEach(() => {
		vi.resetModules();
	});

	it("throws if no API key provided", async () => {
		delete process.env.ELEVENLABS_API_KEY;
		const { ElevenLabsTTSProvider } = await import("../index.js");
		expect(() => new ElevenLabsTTSProvider({})).toThrow(
			"ELEVENLABS_API_KEY is required",
		);
	});

	it("uses env var API key when not in config", async () => {
		process.env.ELEVENLABS_API_KEY = "env-key-456";
		const { ElevenLabsTTSProvider } = await import("../index.js");
		const provider = new ElevenLabsTTSProvider({});
		expect(provider.metadata.name).toBe("elevenlabs");
		delete process.env.ELEVENLABS_API_KEY;
	});

	it("metadata has correct type and name", async () => {
		process.env.ELEVENLABS_API_KEY = "test-key";
		const { ElevenLabsTTSProvider } = await import("../index.js");
		const provider = new ElevenLabsTTSProvider({ apiKey: "test-key" });
		expect(provider.metadata.name).toBe("elevenlabs");
		expect(provider.metadata.type).toBe("tts");
		delete process.env.ELEVENLABS_API_KEY;
	});

	it("metadata.local is false (cloud provider)", async () => {
		process.env.ELEVENLABS_API_KEY = "test-key";
		const { ElevenLabsTTSProvider } = await import("../index.js");
		const provider = new ElevenLabsTTSProvider({ apiKey: "test-key" });
		expect(provider.metadata.local).toBe(false);
		delete process.env.ELEVENLABS_API_KEY;
	});
});
