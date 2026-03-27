import { beforeEach, describe, expect, it, vi } from "vitest";

// Import the plugin
import plugin from "../src/index.js";

describe("wopr-plugin-tailscale-funnel", () => {
	it("exports a valid WOPRPlugin object", () => {
		expect(plugin).toBeDefined();
		expect(plugin.name).toBe("@wopr-network/wopr-plugin-tailscale-funnel");
		expect(plugin.version).toBe("1.0.0");
		expect(plugin.description).toBeDefined();
		expect(typeof plugin.init).toBe("function");
		expect(typeof plugin.shutdown).toBe("function");
	});

	it("has a manifest", () => {
		expect(plugin.manifest).toBeDefined();
		expect(plugin.manifest!.name).toBe("@wopr-network/wopr-plugin-tailscale-funnel");
		expect(plugin.manifest!.requires?.bins).toContain("tailscale");
	});

	it("has CLI commands", () => {
		expect(plugin.commands).toBeDefined();
		expect(plugin.commands!.length).toBe(1);
		expect(plugin.commands![0].name).toBe("funnel");
	});

	describe("init", () => {
		it("handles disabled config gracefully", async () => {
			const mockCtx = {
				log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
				getConfig: () => ({ enabled: false }),
				registerExtension: vi.fn(),
				unregisterExtension: vi.fn(),
				registerConfigSchema: vi.fn(),
				unregisterConfigSchema: vi.fn(),
			};

			await plugin.init!(mockCtx as any);
			// Should log that it's disabled, should NOT register extension
			expect(mockCtx.registerExtension).not.toHaveBeenCalled();
		});
	});

	describe("shutdown", () => {
		beforeEach(async () => {
			// Reset plugin state between tests
			await plugin.shutdown!();
		});

		it("is idempotent (safe to call twice)", async () => {
			await plugin.shutdown!();
			await plugin.shutdown!();
			// No throw = pass
		});
	});
});
