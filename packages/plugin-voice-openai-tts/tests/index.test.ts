import type { ConfigField } from "@wopr-network/plugin-types";
import { afterEach, describe, expect, it, vi } from "vitest";
import plugin from "./index.js";

function mockCtx(config: Record<string, unknown> = {}) {
	return {
		getConfig: vi.fn().mockReturnValue(config),
		registerTTSProvider: vi.fn(),
		registerConfigSchema: vi.fn(),
		unregisterConfigSchema: vi.fn(),
		unregisterCapabilityProvider: vi.fn(),
		log: {
			info: vi.fn(),
			error: vi.fn(),
			warn: vi.fn(),
			debug: vi.fn(),
		},
	};
}

afterEach(async () => {
	await plugin.shutdown?.();
});

describe("plugin manifest", () => {
	it("has required top-level fields", () => {
		expect(plugin.name).toBe("voice-openai-tts");
		expect(plugin.version).toBe("1.0.0");
	});

	it("has manifest with category and capabilities", () => {
		expect(plugin.manifest).toBeDefined();
		expect(plugin.manifest?.category).toBe("voice");
		expect(plugin.manifest?.capabilities).toContain("tts");
	});

	it("manifest provides tts capability entry", () => {
		const provides = plugin.manifest?.provides?.capabilities ?? [];
		expect(provides.length).toBeGreaterThan(0);
		expect(provides[0].type).toBe("tts");
		expect(provides[0].id).toBe("openai-tts");
	});

	it("manifest configSchema has apiKey field with secret and setupFlow", () => {
		const fields: ConfigField[] = plugin.manifest?.configSchema?.fields ?? [];
		const apiKeyField = fields.find((f) => f.name === "apiKey");
		expect(apiKeyField).toBeDefined();
		expect(apiKeyField?.secret).toBe(true);
		expect(apiKeyField?.setupFlow).toBe("paste");
	});

	it("manifest has tags and icon", () => {
		expect(plugin.manifest?.tags).toContain("tts");
		expect(plugin.manifest?.tags).toContain("openai");
		expect(plugin.manifest?.icon).toBeDefined();
	});
});

describe("plugin init", () => {
	it("registers TTS provider with valid config", async () => {
		const ctx = mockCtx({ apiKey: "sk-test-key" });
		await plugin.init?.(ctx as never);
		expect(ctx.registerTTSProvider).toHaveBeenCalledWith(
			expect.objectContaining({
				metadata: expect.objectContaining({ name: "openai-tts" }),
			}),
		);
	});

	it("logs error when API key is missing", async () => {
		const ctx = mockCtx({});
		const origEnv = process.env.OPENAI_API_KEY;
		delete process.env.OPENAI_API_KEY;

		await plugin.init?.(ctx as never);

		expect(ctx.log.error).toHaveBeenCalledWith(
			expect.stringContaining("OPENAI_API_KEY required"),
		);

		if (origEnv !== undefined) process.env.OPENAI_API_KEY = origEnv;
	});

	it("logs error on invalid voice", async () => {
		const ctx = mockCtx({ apiKey: "sk-test-key", voice: "invalid-voice" });
		await plugin.init?.(ctx as never);
		expect(ctx.log.error).toHaveBeenCalledWith(
			expect.stringContaining("Invalid voice"),
		);
	});
});

describe("plugin shutdown", () => {
	it("is idempotent — calling twice does not throw", async () => {
		const ctx = mockCtx({ apiKey: "sk-test-key" });
		await plugin.init?.(ctx as never);
		await plugin.shutdown?.();
		await expect(plugin.shutdown?.()).resolves.not.toThrow();
	});

	it("calls unregisterCapabilityProvider on shutdown", async () => {
		const ctx = mockCtx({ apiKey: "sk-test-key" });
		await plugin.init?.(ctx as never);
		await plugin.shutdown?.();
		expect(ctx.unregisterCapabilityProvider).toHaveBeenCalledWith(
			"tts",
			"openai-tts",
		);
	});
});

describe("synthesize", () => {
	it("calls OpenAI API with correct parameters", async () => {
		const ctx = mockCtx({ apiKey: "sk-test-key" });
		await plugin.init?.(ctx as never);

		const pcmData = new ArrayBuffer(48000);
		const mockFetch = vi.fn().mockResolvedValue({
			ok: true,
			arrayBuffer: () => Promise.resolve(pcmData),
		});
		const origFetch = globalThis.fetch;
		globalThis.fetch = mockFetch as typeof fetch;

		try {
			const registeredProvider = ctx.registerTTSProvider.mock.calls[0]?.[0];
			expect(registeredProvider).toBeDefined();
			const result = await registeredProvider.synthesize("Hello world");

			expect(mockFetch).toHaveBeenCalledWith(
				"https://api.openai.com/v1/audio/speech",
				expect.objectContaining({
					method: "POST",
					headers: expect.objectContaining({
						Authorization: "Bearer sk-test-key",
					}),
				}),
			);
			expect(result.format).toBe("pcm_s16le");
			expect(result.sampleRate).toBe(24000);
			expect(result.durationMs).toBe(1000);
		} finally {
			globalThis.fetch = origFetch;
		}
	});

	it("throws on non-OK response", async () => {
		const ctx = mockCtx({ apiKey: "sk-test-key" });
		await plugin.init?.(ctx as never);

		const mockFetch = vi.fn().mockResolvedValue({
			ok: false,
			status: 401,
			text: () => Promise.resolve("Unauthorized"),
		});
		const origFetch = globalThis.fetch;
		globalThis.fetch = mockFetch as typeof fetch;

		try {
			const registeredProvider = ctx.registerTTSProvider.mock.calls[0]?.[0];
			await expect(registeredProvider.synthesize("Hello")).rejects.toThrow(
				"OpenAI TTS failed: 401",
			);
		} finally {
			globalThis.fetch = origFetch;
		}
	});
});
