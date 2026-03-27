import { describe, expect, it, vi } from "vitest";

vi.mock("@openai/codex-sdk", () => ({
	Codex: vi.fn(),
}));

vi.mock("node:fs", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:fs")>();
	return {
		...actual,
		existsSync: vi.fn(() => false),
		readFileSync: vi.fn(() => "{}"),
	};
});

describe("provider-codex plugin", () => {
	it("exports a valid WOPRPlugin with required fields", async () => {
		const mod = await import("../index.js");
		const plugin = mod.default;

		expect(plugin).toBeDefined();
		expect(plugin.name).toBe("provider-codex");
		expect(plugin.version).toBe("2.0.0");
		expect(typeof plugin.init).toBe("function");
		expect(typeof plugin.shutdown).toBe("function");
	});

	it("has a manifest with required fields", async () => {
		const mod = await import("../index.js");
		const plugin = mod.default;

		expect(plugin.manifest).toBeDefined();
		expect(plugin.manifest?.name).toBe(
			"@wopr-network/wopr-plugin-provider-codex",
		);
		expect(plugin.manifest?.capabilities).toContain("provider");
		expect(plugin.manifest?.configSchema).toBeDefined();
	});

	it("init registers provider without throwing", async () => {
		const mod = await import("../index.js");
		const plugin = mod.default;

		const ctx = {
			log: { info: vi.fn() },
			registerProvider: vi.fn(),
			registerConfigSchema: vi.fn(),
		};

		await expect(plugin.init?.(ctx as any)).resolves.not.toThrow();
		expect(ctx.registerProvider).toHaveBeenCalledTimes(1);
	});

	it("shutdown completes without throwing", async () => {
		const mod = await import("../index.js");
		const plugin = mod.default;

		await expect(plugin.shutdown?.()).resolves.not.toThrow();
	});
});
