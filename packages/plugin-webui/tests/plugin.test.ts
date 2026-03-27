import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import plugin from "../src/plugin.js";

// Mock node:fs so we can control existsSync
vi.mock("node:fs", async () => {
	const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
	return {
		...actual,
		existsSync: vi.fn(() => true),
		createReadStream: vi.fn(() => ({
			pipe: vi.fn(),
		})),
	};
});

// Mock node:http to avoid binding real ports
vi.mock("node:http", () => ({
	default: {
		createServer: vi.fn(() => ({
			listen: vi.fn(),
			close: vi.fn((cb: (err?: Error) => void) => cb()),
			on: vi.fn(),
		})),
	},
}));

function createMockContext() {
	return {
		getConfig: vi.fn(() => ({ port: 4000, host: "0.0.0.0" })),
		getPluginDir: vi.fn(() => "/fake/plugin/dir"),
		registerConfigSchema: vi.fn(),
		unregisterConfigSchema: vi.fn(),
		registerWebUiExtension: vi.fn(),
		unregisterWebUiExtension: vi.fn(),
		log: {
			info: vi.fn(),
			warn: vi.fn(),
			error: vi.fn(),
			debug: vi.fn(),
		},
	};
}

describe("wopr-plugin-webui", () => {
	let mockCtx: ReturnType<typeof createMockContext>;

	beforeEach(() => {
		mockCtx = createMockContext();
	});

	afterEach(async () => {
		// Ensure shutdown is called to reset module-level state
		if (plugin.shutdown) {
			await plugin.shutdown();
		}
	});

	it("has correct plugin metadata", () => {
		expect(plugin.name).toBe("wopr-plugin-webui");
		expect(plugin.version).toBe("0.2.0");
		expect(plugin.manifest).toBeDefined();
		expect(plugin.manifest!.capabilities).toContain("webui");
		expect(plugin.manifest!.category).toBe("ui");
		expect(plugin.manifest!.configSchema).toBeDefined();
		expect(plugin.manifest!.lifecycle).toBeDefined();
	});

	it("registers config schema on init", async () => {
		await plugin.init!(mockCtx as any);

		expect(mockCtx.registerConfigSchema).toHaveBeenCalledWith(
			"wopr-plugin-webui",
			expect.objectContaining({ title: "Web UI" }),
		);
	});

	it("registers web UI extension on init", async () => {
		await plugin.init!(mockCtx as any);

		expect(mockCtx.registerWebUiExtension).toHaveBeenCalledWith(
			expect.objectContaining({
				id: "main",
				title: "Web Dashboard",
				url: "http://0.0.0.0:4000",
			}),
		);
	});

	it("uses default port and host when config is empty", async () => {
		mockCtx.getConfig.mockReturnValue({});

		await plugin.init!(mockCtx as any);

		expect(mockCtx.registerWebUiExtension).toHaveBeenCalledWith(
			expect.objectContaining({
				url: "http://127.0.0.1:3000",
			}),
		);
	});

	it("skips server start if dist/ does not exist", async () => {
		const { existsSync: mockExistsSync } = await import("node:fs");
		(mockExistsSync as any).mockReturnValue(false);

		await plugin.init!(mockCtx as any);

		expect(mockCtx.log.error).toHaveBeenCalledWith(expect.stringContaining("dist/ folder not found"));
		expect(mockCtx.registerWebUiExtension).not.toHaveBeenCalled();

		// Restore
		(mockExistsSync as any).mockReturnValue(true);
	});

	it("unregisters everything on shutdown", async () => {
		await plugin.init!(mockCtx as any);
		await plugin.shutdown!();

		expect(mockCtx.unregisterWebUiExtension).toHaveBeenCalledWith("main");
		expect(mockCtx.unregisterConfigSchema).toHaveBeenCalledWith("wopr-plugin-webui");
	});

	it("shutdown is idempotent", async () => {
		await plugin.init!(mockCtx as any);
		await plugin.shutdown!();
		// Second call should not throw
		await plugin.shutdown!();

		// unregister only called once (from first shutdown)
		expect(mockCtx.unregisterWebUiExtension).toHaveBeenCalledTimes(1);
	});
});
