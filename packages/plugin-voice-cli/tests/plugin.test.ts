import { readFileSync } from "node:fs";
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

describe("voice-cli plugin metadata", () => {
	it("has name, version, description, commands", () => {
		expect(plugin.name).toBe("voice-cli");
		expect(plugin.version).toBe("1.0.0");
		expect(plugin.commands).toHaveLength(1);
		expect(plugin.commands?.[0].name).toBe("voice");
	});
});

describe("voice-cli plugin lifecycle", () => {
	it("init stores ctx and logs registration", async () => {
		const ctx = makeCtx();
		await plugin.init(ctx);
		expect(ctx.log.info).toHaveBeenCalledWith(
			expect.stringContaining("Voice CLI commands registered"),
		);
	});

	it("plugin has no shutdown method", () => {
		expect(plugin.shutdown).toBeUndefined();
	});
});

describe("code quality", () => {
	it("has no catch (error: any) blocks", () => {
		const source = readFileSync(
			new URL("../index.ts", import.meta.url),
			"utf8",
		);
		expect(source).not.toContain("catch (err: any)");
		expect(source).not.toContain("catch (error: any)");
	});
});
