import { describe, expect, it, vi } from "vitest";

vi.mock("@openai/codex-sdk", () => ({ Codex: vi.fn() }));
vi.mock("node:fs", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:fs")>();
	return {
		...actual,
		existsSync: vi.fn(() => false),
		readFileSync: vi.fn(() => "{}"),
	};
});

describe("temperatureToEffort", () => {
	it("returns 'medium' for undefined", async () => {
		const { temperatureToEffort } = await import("../index.js");
		expect(temperatureToEffort(undefined)).toBe("medium");
	});

	it("returns 'xhigh' for temp = 0", async () => {
		const { temperatureToEffort } = await import("../index.js");
		expect(temperatureToEffort(0)).toBe("xhigh");
	});

	it("returns 'xhigh' for temp = 0.2 (boundary)", async () => {
		const { temperatureToEffort } = await import("../index.js");
		expect(temperatureToEffort(0.2)).toBe("xhigh");
	});

	it("returns 'xhigh' for temp = 0.1", async () => {
		const { temperatureToEffort } = await import("../index.js");
		expect(temperatureToEffort(0.1)).toBe("xhigh");
	});

	it("returns 'high' for temp = 0.3", async () => {
		const { temperatureToEffort } = await import("../index.js");
		expect(temperatureToEffort(0.3)).toBe("high");
	});

	it("returns 'high' for temp = 0.4 (boundary)", async () => {
		const { temperatureToEffort } = await import("../index.js");
		expect(temperatureToEffort(0.4)).toBe("high");
	});

	it("returns 'medium' for temp = 0.5", async () => {
		const { temperatureToEffort } = await import("../index.js");
		expect(temperatureToEffort(0.5)).toBe("medium");
	});

	it("returns 'medium' for temp = 0.6 (boundary)", async () => {
		const { temperatureToEffort } = await import("../index.js");
		expect(temperatureToEffort(0.6)).toBe("medium");
	});

	it("returns 'low' for temp = 0.7", async () => {
		const { temperatureToEffort } = await import("../index.js");
		expect(temperatureToEffort(0.7)).toBe("low");
	});

	it("returns 'low' for temp = 0.8 (boundary)", async () => {
		const { temperatureToEffort } = await import("../index.js");
		expect(temperatureToEffort(0.8)).toBe("low");
	});

	it("returns 'minimal' for temp = 0.9", async () => {
		const { temperatureToEffort } = await import("../index.js");
		expect(temperatureToEffort(0.9)).toBe("minimal");
	});

	it("returns 'minimal' for temp = 1.0", async () => {
		const { temperatureToEffort } = await import("../index.js");
		expect(temperatureToEffort(1.0)).toBe("minimal");
	});
});
