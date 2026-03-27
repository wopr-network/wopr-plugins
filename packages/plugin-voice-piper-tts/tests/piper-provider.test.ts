import { beforeEach, describe, expect, it } from "vitest";
import { PiperTTSProvider } from "../src/piper-provider.js";

describe("PiperTTSProvider", () => {
	let provider: PiperTTSProvider;

	beforeEach(() => {
		provider = new PiperTTSProvider();
	});

	describe("constructor", () => {
		it("creates provider with default config", () => {
			expect(provider.metadata.name).toBe("piper-tts");
			expect(provider.voices.length).toBeGreaterThan(0);
		});

		it("accepts custom config", () => {
			const custom = new PiperTTSProvider({
				voice: "en_GB-alan-medium",
				speed: 1.5,
				sampleRate: 48000,
			});
			expect(custom).toBeDefined();
		});
	});

	describe("validateConfig", () => {
		it("passes with default config", () => {
			expect(() => provider.validateConfig()).not.toThrow();
		});

		it("throws for invalid voice", () => {
			const p = new PiperTTSProvider({ voice: "nonexistent-voice" });
			expect(() => p.validateConfig()).toThrow("Invalid voice");
		});

		it("throws for invalid sample rate", () => {
			const p = new PiperTTSProvider({ sampleRate: 99999 });
			expect(() => p.validateConfig()).toThrow("Invalid sample rate");
		});

		it("throws for speed below 0.5", () => {
			const p = new PiperTTSProvider({ speed: 0.1 });
			expect(() => p.validateConfig()).toThrow("Invalid speed");
		});

		it("throws for speed above 2.0", () => {
			const p = new PiperTTSProvider({ speed: 3.0 });
			expect(() => p.validateConfig()).toThrow("Invalid speed");
		});

		it("accepts speed boundary values", () => {
			expect(() =>
				new PiperTTSProvider({ speed: 0.5 }).validateConfig(),
			).not.toThrow();
			expect(() =>
				new PiperTTSProvider({ speed: 2.0 }).validateConfig(),
			).not.toThrow();
		});

		it("accepts all valid sample rates", () => {
			for (const rate of [16000, 22050, 24000, 48000]) {
				expect(() =>
					new PiperTTSProvider({ sampleRate: rate }).validateConfig(),
				).not.toThrow();
			}
		});
	});

	describe("voices", () => {
		it("contains expected English voices", () => {
			const ids = provider.voices.map((v) => v.id);
			expect(ids).toContain("en_US-lessac-medium");
			expect(ids).toContain("en_GB-alan-medium");
		});

		it("contains expected non-English voices", () => {
			const ids = provider.voices.map((v) => v.id);
			expect(ids).toContain("fr_FR-upmc-medium");
			expect(ids).toContain("de_DE-thorsten-medium");
		});

		it("all voices have required fields", () => {
			for (const voice of provider.voices) {
				expect(voice.id).toBeTruthy();
				expect(voice.name).toBeTruthy();
				expect(voice.language).toBeTruthy();
				expect(voice.gender).toBeTruthy();
			}
		});
	});

	describe("metadata", () => {
		it("has correct type", () => {
			expect(provider.metadata.type).toBe("tts");
		});

		it("marks as local and docker", () => {
			expect(provider.metadata.local).toBe(true);
			expect(provider.metadata.docker).toBe(true);
		});

		it("requires piper docker image", () => {
			expect(provider.metadata.requires?.docker).toContain(
				"rhasspy/piper:latest",
			);
		});

		it("has install instructions", () => {
			expect(provider.metadata.install?.length).toBeGreaterThan(0);
			expect(provider.metadata.install?.[0].kind).toBe("docker");
		});
	});

	describe("wavToPcm (private, tested via bracket notation)", () => {
		it("strips 44-byte WAV header", () => {
			const header = Buffer.alloc(44);
			header.write("RIFF", 0, "ascii");
			header.write("WAVE", 8, "ascii");
			const pcmData = Buffer.from([1, 2, 3, 4]);
			const wav = Buffer.concat([header, pcmData]);

			// biome-ignore lint/suspicious/noExplicitAny: testing private method
			const result = (provider as any).wavToPcm(wav);
			expect(result).toEqual(pcmData);
		});

		it("throws for non-WAV data", () => {
			const bad = Buffer.alloc(50);
			// biome-ignore lint/suspicious/noExplicitAny: testing private method
			expect(() => (provider as any).wavToPcm(bad)).toThrow("Invalid WAV file");
		});

		it("throws for too-small buffer", () => {
			const tiny = Buffer.alloc(10);
			// biome-ignore lint/suspicious/noExplicitAny: testing private method
			expect(() => (provider as any).wavToPcm(tiny)).toThrow("too small");
		});
	});

	describe("shutdown", () => {
		it("clears internal state without error", async () => {
			await provider.shutdown();
		});

		it("is idempotent — safe to call twice", async () => {
			await provider.shutdown();
			await provider.shutdown();
		});
	});
});
