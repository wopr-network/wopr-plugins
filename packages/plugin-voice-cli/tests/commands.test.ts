import { unlinkSync, writeFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import plugin from "../index.js";

function makeCtx(overrides: Record<string, unknown> = {}) {
	return {
		log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
		getCapabilityProviders: vi.fn(() => []),
		getConfig: vi.fn(() => ({})),
		...overrides,
	} as any;
}

const voiceCmd = plugin.commands?.[0];

describe("voice transcribe", () => {
	it("errors when no file argument given", async () => {
		const ctx = makeCtx();
		await voiceCmd.handler(ctx, ["transcribe"]);
		expect(ctx.log.error).toHaveBeenCalledWith(
			expect.stringContaining("Usage"),
		);
	});

	it("errors when file does not exist", async () => {
		const ctx = makeCtx();
		await voiceCmd.handler(ctx, ["transcribe", "/nonexistent/file.wav"]);
		expect(ctx.log.error).toHaveBeenCalledWith(
			expect.stringContaining("File not found"),
		);
	});

	it("errors when no STT provider is available", async () => {
		const ctx = makeCtx();
		const tmpFile = "/tmp/wopr-test-audio.wav";
		writeFileSync(tmpFile, Buffer.alloc(44));
		try {
			await voiceCmd.handler(ctx, ["transcribe", tmpFile]);
			expect(ctx.log.error).toHaveBeenCalledWith(
				expect.stringContaining("No STT provider"),
			);
		} finally {
			unlinkSync(tmpFile);
		}
	});
});

describe("voice synthesize", () => {
	it("errors when no voice or text given", async () => {
		const ctx = makeCtx();
		await voiceCmd.handler(ctx, ["synthesize"]);
		expect(ctx.log.error).toHaveBeenCalledWith(
			expect.stringContaining("Usage"),
		);
	});

	it("errors when no TTS provider is available", async () => {
		const ctx = makeCtx();
		await voiceCmd.handler(ctx, ["synthesize", "coral", "hello"]);
		expect(ctx.log.error).toHaveBeenCalledWith(
			expect.stringContaining("No TTS provider"),
		);
	});
});

describe("voice list", () => {
	it("errors when no TTS provider", async () => {
		const ctx = makeCtx();
		await voiceCmd.handler(ctx, ["list"]);
		expect(ctx.log.error).toHaveBeenCalledWith("No TTS provider available.");
	});

	it("lists voices when TTS available", async () => {
		const ttsProvider = {
			metadata: { name: "test-tts", version: "1.0.0" },
			voices: [{ id: "v1", name: "Voice1", gender: "female", description: "Test" }],
			synthesize: vi.fn(),
		};
		const ctx = makeCtx({
			getCapabilityProviders: vi.fn((capability: string) =>
				capability === "tts" ? [ttsProvider] : [],
			),
		});
		await voiceCmd.handler(ctx, ["list"]);
		expect(ctx.log.info).toHaveBeenCalledWith(expect.stringContaining("v1"));
	});

	it("handles provider with malformed voice entries without throwing", async () => {
		const malformedProvider = {
			metadata: { name: "test-tts", version: "1.0.0" },
			voices: [{}, { id: "v1", name: "Voice1" }],
			synthesize: vi.fn(),
		};
		const ctx = makeCtx({
			getCapabilityProviders: vi.fn((capability: string) =>
				capability === "tts" ? [malformedProvider] : [],
			),
		});
		await expect(voiceCmd.handler(ctx, ["list"])).resolves.toBeUndefined();
		// Provider is rejected by isTTSProvider (malformed voice lacks id string)
		// so command reports gracefully rather than throwing
		expect(ctx.log.error).toHaveBeenCalledWith("No TTS provider available.");
	});
});

describe("voice providers", () => {
	it("shows none installed when no providers", async () => {
		const ctx = makeCtx();
		await voiceCmd.handler(ctx, ["providers"]);
		expect(ctx.log.info).toHaveBeenCalledWith("  None installed");
	});
});

describe("unknown subcommand", () => {
	it("shows error for unknown subcommand", async () => {
		const ctx = makeCtx();
		await voiceCmd.handler(ctx, ["bogus"]);
		expect(ctx.log.error).toHaveBeenCalledWith("Unknown subcommand: bogus");
	});
});
