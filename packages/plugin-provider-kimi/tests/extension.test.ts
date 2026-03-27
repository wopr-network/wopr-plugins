/**
 * Tests for provider-kimi extension registration (WOP-268)
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock winston before importing plugin
vi.mock("winston", () => {
	const format = {
		combine: vi.fn(),
		timestamp: vi.fn(),
		errors: vi.fn(),
		json: vi.fn(),
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

// Mock node:fs to prevent reading real credential files
vi.mock("node:fs", () => ({
	existsSync: vi.fn(() => false),
}));

// Mock the kimi SDK
vi.mock("@moonshot-ai/kimi-agent-sdk", () => ({
	createSession: vi.fn().mockReturnValue({
		sessionId: "test-session",
		close: vi.fn(),
		prompt: vi.fn(),
	}),
}));

describe("provider-kimi extension (WOP-268)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("calls ctx.registerExtension with 'provider-kimi' during init", async () => {
		const { default: plugin } = await import("../src/index.js");

		const registerExtension = vi.fn();
		const ctx = {
			log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
			registerProvider: vi.fn(),
			registerConfigSchema: vi.fn(),
			registerExtension,
		};

		await plugin.init(ctx as any);

		expect(registerExtension).toHaveBeenCalledWith(
			"provider-kimi",
			expect.objectContaining({ getModelInfo: expect.any(Function) }),
		);
	});

	it("does not throw when ctx.registerExtension is absent", async () => {
		const { default: plugin } = await import("../src/index.js");

		const ctx = {
			log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
			registerProvider: vi.fn(),
			registerConfigSchema: vi.fn(),
			// No registerExtension
		};

		await expect(plugin.init(ctx as any)).resolves.not.toThrow();
	});

	it("extension.getModelInfo returns Kimi K2 model info", async () => {
		const { default: plugin } = await import("../src/index.js");

		let capturedExtension: any;
		const ctx = {
			log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
			registerProvider: vi.fn(),
			registerConfigSchema: vi.fn(),
			registerExtension: vi.fn((_name: string, ext: unknown) => {
				capturedExtension = ext;
			}),
		};

		await plugin.init(ctx as any);

		expect(capturedExtension).toBeDefined();
		const models = await capturedExtension.getModelInfo();

		expect(Array.isArray(models)).toBe(true);
		expect(models).toHaveLength(1);
		expect(models[0].id).toBe("kimi-k2");
		expect(models[0].name).toBe("Kimi K2");
	});

	it("model info includes required display fields", async () => {
		const { default: plugin } = await import("../src/index.js");

		let capturedExtension: any;
		const ctx = {
			log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
			registerProvider: vi.fn(),
			registerConfigSchema: vi.fn(),
			registerExtension: vi.fn((_name: string, ext: unknown) => {
				capturedExtension = ext;
			}),
		};

		await plugin.init(ctx as any);

		const models = await capturedExtension.getModelInfo();
		for (const model of models) {
			expect(model).toHaveProperty("id");
			expect(model).toHaveProperty("name");
			expect(model).toHaveProperty("contextWindow");
			expect(model).toHaveProperty("maxOutput");
			expect(model).toHaveProperty("legacy");
		}
	});
});
