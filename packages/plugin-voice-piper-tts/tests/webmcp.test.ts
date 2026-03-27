import { beforeEach, describe, expect, it, vi } from "vitest";
import { getWebMCPHandlers, getWebMCPToolDeclarations } from "../src/webmcp.js";

const mockProvider = {
	metadata: {
		name: "piper-tts",
		type: "tts",
		version: "1.0.0",
		description: "Local TTS using Piper in Docker",
		local: true,
		capabilities: ["voice-selection", "speed-control"],
	},
	voices: [
		{
			id: "en_US-lessac-medium",
			name: "Lessac (US English)",
			language: "en-US",
			gender: "male",
		},
		{
			id: "en_GB-alan-medium",
			name: "Alan (British English)",
			language: "en-GB",
			gender: "male",
		},
		{
			id: "de_DE-thorsten-medium",
			name: "Thorsten (German)",
			language: "de-DE",
			gender: "male",
		},
		{
			id: "fr_FR-upmc-medium",
			name: "UPMC (French)",
			language: "fr-FR",
			gender: "male",
		},
	],
	healthCheck: vi.fn().mockResolvedValue(true),
};

describe("getWebMCPToolDeclarations", () => {
	it("returns 2 declarations", () => {
		const decls = getWebMCPToolDeclarations();
		expect(decls).toHaveLength(2);
	});

	it("all declarations have readOnlyHint: true", () => {
		const decls = getWebMCPToolDeclarations();
		for (const d of decls) {
			expect(d.annotations?.readOnlyHint).toBe(true);
		}
	});

	it("declaration names are namespaced with piper-tts.", () => {
		const decls = getWebMCPToolDeclarations();
		for (const d of decls) {
			expect(d.name).toMatch(/^piper-tts\./);
		}
	});

	it("includes getStatus and listVoices", () => {
		const names = getWebMCPToolDeclarations().map((d) => d.name);
		expect(names).toContain("piper-tts.getStatus");
		expect(names).toContain("piper-tts.listVoices");
	});
});

describe("getWebMCPHandlers", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe("piper-tts.getStatus", () => {
		it("returns provider info", async () => {
			const handlers = getWebMCPHandlers(mockProvider);
			// biome-ignore lint/suspicious/noExplicitAny: testing dynamic handler return shape
			const result = (await handlers["piper-tts.getStatus"]({})) as any;
			expect(result.provider).toBe("piper-tts");
			expect(result.type).toBe("tts");
			expect(result.local).toBe(true);
			expect(result.healthy).toBe(true);
			expect(result.voiceCount).toBe(4);
		});

		it("does not expose internal config or private fields", async () => {
			const handlers = getWebMCPHandlers(mockProvider);
			// biome-ignore lint/suspicious/noExplicitAny: testing dynamic handler return shape
			const result = (await handlers["piper-tts.getStatus"]({})) as any;
			expect(result).not.toHaveProperty("config");
			expect(result).not.toHaveProperty("docker");
			expect(result).not.toHaveProperty("downloadedModels");
		});
	});

	describe("piper-tts.listVoices", () => {
		it("returns all voices when no language filter", async () => {
			const handlers = getWebMCPHandlers(mockProvider);
			// biome-ignore lint/suspicious/noExplicitAny: testing dynamic handler return shape
			const result = (await handlers["piper-tts.listVoices"]({})) as any;
			expect(result.count).toBe(4);
			expect(result.voices).toHaveLength(4);
		});

		it("filters voices by language prefix", async () => {
			const handlers = getWebMCPHandlers(mockProvider);
			const result = (await handlers["piper-tts.listVoices"]({
				language: "en",
				// biome-ignore lint/suspicious/noExplicitAny: testing dynamic handler return shape
			})) as any;
			expect(result.count).toBe(2);
		});

		it("filters voices by full language tag", async () => {
			const handlers = getWebMCPHandlers(mockProvider);
			const result = (await handlers["piper-tts.listVoices"]({
				language: "de-DE",
				// biome-ignore lint/suspicious/noExplicitAny: testing dynamic handler return shape
			})) as any;
			expect(result.count).toBe(1);
			expect(result.voices[0].id).toBe("de_DE-thorsten-medium");
		});

		it("returns empty list when language matches nothing", async () => {
			const handlers = getWebMCPHandlers(mockProvider);
			const result = (await handlers["piper-tts.listVoices"]({
				language: "ja",
				// biome-ignore lint/suspicious/noExplicitAny: testing dynamic handler return shape
			})) as any;
			expect(result.count).toBe(0);
		});

		it("does not mutate original voices array", async () => {
			const handlers = getWebMCPHandlers(mockProvider);
			const before = mockProvider.voices.length;
			await handlers["piper-tts.listVoices"]({ language: "en" });
			expect(mockProvider.voices.length).toBe(before);
		});
	});
});
