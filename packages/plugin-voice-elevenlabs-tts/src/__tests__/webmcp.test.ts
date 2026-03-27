import { describe, expect, it, vi } from "vitest";
import type { ElevenLabsTTSProvider } from "../index.js";
import { getWebMCPHandlers, getWebMCPToolDeclarations } from "../webmcp.js";

type HandlerResult = Record<string, unknown>;

interface VoiceResult extends HandlerResult {
	provider: string;
	count: number;
	voices: Array<{
		id: string;
		name: string;
		language: string | null;
		gender: string | null;
	}>;
}

interface StatusResult extends HandlerResult {
	provider: string;
	type: string;
	version: string;
	healthy: boolean;
	voiceCount: number;
}

interface ModelsResult extends HandlerResult {
	provider: string;
	models: Array<{ id: string; name: string; description: string }>;
	currentModel: string;
}

const mockProvider = {
	metadata: {
		name: "elevenlabs",
		type: "tts" as const,
		version: "1.0.0",
		description: "ElevenLabs high-quality text-to-speech",
		local: false,
		capabilities: ["streaming", "voice-selection"],
		requires: { env: ["ELEVENLABS_API_KEY"] },
		install: [],
		primaryEnv: "ELEVENLABS_API_KEY",
		emoji: "🔊",
		homepage: "https://elevenlabs.io",
	},
	voices: [
		{ id: "v1", name: "Rachel", language: "en-US", gender: "female" as const },
		{ id: "v2", name: "Clyde", language: "en-GB", gender: "male" as const },
		{ id: "v3", name: "Bella", language: "fr-FR", gender: "female" as const },
	],
	config: { defaultModelId: "eleven_turbo_v2_5" },
	healthCheck: vi.fn().mockResolvedValue(true),
	fetchVoices: vi.fn().mockResolvedValue([
		{
			id: "v1",
			name: "Rachel",
			language: "en-US",
			gender: "female" as const,
		},
	]),
} as unknown as ElevenLabsTTSProvider & {
	fetchVoices: ReturnType<typeof vi.fn>;
};

describe("getWebMCPToolDeclarations", () => {
	it("returns 3 declarations", () => {
		const decls = getWebMCPToolDeclarations();
		expect(decls).toHaveLength(3);
	});

	it("all declarations have readOnlyHint: true", () => {
		const decls = getWebMCPToolDeclarations();
		for (const d of decls) {
			expect(d.annotations?.readOnlyHint).toBe(true);
		}
	});

	it("declaration names are namespaced with elevenlabs-tts.", () => {
		const decls = getWebMCPToolDeclarations();
		for (const d of decls) {
			expect(d.name).toMatch(/^elevenlabs-tts\./);
		}
	});

	it("includes getStatus, listVoices, listModels", () => {
		const names = getWebMCPToolDeclarations().map((d) => d.name);
		expect(names).toContain("elevenlabs-tts.getStatus");
		expect(names).toContain("elevenlabs-tts.listVoices");
		expect(names).toContain("elevenlabs-tts.listModels");
	});
});

describe("getWebMCPHandlers", () => {
	describe("elevenlabs-tts.getStatus", () => {
		it("returns provider info", async () => {
			const handlers = getWebMCPHandlers(mockProvider, "eleven_turbo_v2_5");
			const result = (await handlers["elevenlabs-tts.getStatus"](
				{},
			)) as StatusResult;
			expect(result.provider).toBe("elevenlabs");
			expect(result.type).toBe("tts");
			expect(result.version).toBe("1.0.0");
			expect(result.healthy).toBe(true);
			expect(result.voiceCount).toBe(3);
		});

		it("does not expose apiKey", async () => {
			const handlers = getWebMCPHandlers(mockProvider, "eleven_turbo_v2_5");
			const result = await handlers["elevenlabs-tts.getStatus"]({});
			expect(JSON.stringify(result)).not.toContain("apiKey");
			expect(JSON.stringify(result)).not.toContain("sk-");
		});
	});

	describe("elevenlabs-tts.listVoices", () => {
		it("returns all voices when no language filter", async () => {
			const handlers = getWebMCPHandlers(mockProvider, "eleven_turbo_v2_5");
			const result = (await handlers["elevenlabs-tts.listVoices"](
				{},
			)) as VoiceResult;
			expect(result.count).toBe(3);
			expect(result.voices).toHaveLength(3);
			expect(result.voices[0].id).toBe("v1");
		});

		it("filters voices by language prefix", async () => {
			const handlers = getWebMCPHandlers(mockProvider, "eleven_turbo_v2_5");
			const result = (await handlers["elevenlabs-tts.listVoices"]({
				language: "en",
			})) as VoiceResult;
			expect(result.count).toBe(2);
			expect(result.voices.every((v) => v.language?.startsWith("en"))).toBe(
				true,
			);
		});

		it("filters voices by full language tag", async () => {
			const handlers = getWebMCPHandlers(mockProvider, "eleven_turbo_v2_5");
			const result = (await handlers["elevenlabs-tts.listVoices"]({
				language: "fr-FR",
			})) as VoiceResult;
			expect(result.count).toBe(1);
			expect(result.voices[0].id).toBe("v3");
		});

		it("returns empty list when language matches nothing", async () => {
			const handlers = getWebMCPHandlers(mockProvider, "eleven_turbo_v2_5");
			const result = (await handlers["elevenlabs-tts.listVoices"]({
				language: "ja",
			})) as VoiceResult;
			expect(result.count).toBe(0);
		});

		it("calls fetchVoices when cache is empty", async () => {
			const emptyProvider = {
				...mockProvider,
				voices: [],
			} as unknown as ElevenLabsTTSProvider & {
				fetchVoices: ReturnType<typeof vi.fn>;
			};
			const handlers = getWebMCPHandlers(emptyProvider, "eleven_turbo_v2_5");
			await handlers["elevenlabs-tts.listVoices"]({});
			expect(emptyProvider.fetchVoices).toHaveBeenCalled();
		});

		it("does not expose apiKey", async () => {
			const handlers = getWebMCPHandlers(mockProvider, "eleven_turbo_v2_5");
			const result = await handlers["elevenlabs-tts.listVoices"]({});
			expect(JSON.stringify(result)).not.toContain("apiKey");
			expect(JSON.stringify(result)).not.toContain("sk-");
		});
	});

	describe("elevenlabs-tts.listModels", () => {
		it("returns model list with 6 entries", async () => {
			const handlers = getWebMCPHandlers(mockProvider, "eleven_turbo_v2_5");
			const result = (await handlers["elevenlabs-tts.listModels"](
				{},
			)) as ModelsResult;
			expect(result.models).toHaveLength(6);
		});

		it("includes currentModel", async () => {
			const handlers = getWebMCPHandlers(mockProvider, "eleven_turbo_v2_5");
			const result = (await handlers["elevenlabs-tts.listModels"](
				{},
			)) as ModelsResult;
			expect(result.currentModel).toBe("eleven_turbo_v2_5");
		});

		it("model list includes eleven_v3", async () => {
			const handlers = getWebMCPHandlers(mockProvider, "eleven_v3");
			const result = (await handlers["elevenlabs-tts.listModels"](
				{},
			)) as ModelsResult;
			const ids = result.models.map((m) => m.id);
			expect(ids).toContain("eleven_v3");
			expect(ids).toContain("eleven_turbo_v2_5");
			expect(ids).toContain("eleven_multilingual_v2");
		});
	});
});
