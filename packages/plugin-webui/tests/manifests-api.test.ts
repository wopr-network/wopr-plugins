import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../src/lib/api";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function mockJsonResponse(data: unknown, ok = true, status = 200) {
	return {
		ok,
		status,
		json: vi.fn().mockResolvedValue(data),
	};
}

beforeEach(() => {
	mockFetch.mockReset();
});

describe("api.getPluginManifests", () => {
	it("should GET /api/plugins/manifests", async () => {
		const manifests = {
			manifests: [
				{
					name: "@wopr-network/plugin-discord",
					version: "1.0.0",
					description: "Discord channel plugin",
					icon: "🎮",
					capabilities: ["channel"],
					webui: {
						panels: [
							{
								id: "discord-status",
								title: "Discord Status",
								type: "status",
								endpoints: ["/healthz"],
							},
						],
					},
				},
			],
		};
		mockFetch.mockResolvedValue(mockJsonResponse(manifests));

		const result = await api.getPluginManifests();

		expect(mockFetch).toHaveBeenCalledWith("/api/plugins/manifests", {
			headers: { "Content-Type": "application/json" },
		});
		expect(result).toEqual(manifests);
		expect(result.manifests).toHaveLength(1);
		expect(result.manifests[0].webui?.panels).toHaveLength(1);
	});

	it("should return empty manifests array", async () => {
		mockFetch.mockResolvedValue(mockJsonResponse({ manifests: [] }));

		const result = await api.getPluginManifests();

		expect(result.manifests).toEqual([]);
	});
});

describe("api.pollPluginEndpoint", () => {
	it("should GET /api/plugins/:name/proxy/:endpoint", async () => {
		const data = { status: "healthy", uptime: 12345 };
		mockFetch.mockResolvedValue(mockJsonResponse(data));

		const result = await api.pollPluginEndpoint("@wopr-network/plugin-discord", "/healthz");

		expect(mockFetch).toHaveBeenCalledWith("/api/plugins/%40wopr-network%2Fplugin-discord/proxy/healthz", {
			headers: { "Content-Type": "application/json" },
		});
		expect(result).toEqual(data);
	});

	it("should throw on non-ok response", async () => {
		mockFetch.mockResolvedValue(mockJsonResponse({ error: "Plugin not found" }, false, 404));

		await expect(api.pollPluginEndpoint("missing-plugin", "/healthz")).rejects.toThrow("Plugin not found");
	});
});

describe("api.getPluginConfig", () => {
	it("should GET /api/plugins/:name/config", async () => {
		const config = { token: "***", guildId: "12345" };
		mockFetch.mockResolvedValue(mockJsonResponse(config));

		const result = await api.getPluginConfig("@wopr-network/plugin-discord");

		expect(mockFetch).toHaveBeenCalledWith("/api/plugins/%40wopr-network%2Fplugin-discord/config", {
			headers: { "Content-Type": "application/json" },
		});
		expect(result).toEqual(config);
	});
});

describe("api.setPluginConfigValue", () => {
	it("should PUT /api/plugins/:name/config/:key with value", async () => {
		mockFetch.mockResolvedValue(mockJsonResponse({}));

		await api.setPluginConfigValue("@wopr-network/plugin-discord", "guildId", "99999");

		expect(mockFetch).toHaveBeenCalledWith("/api/plugins/%40wopr-network%2Fplugin-discord/config/guildId", {
			method: "PUT",
			body: JSON.stringify({ value: "99999" }),
			headers: { "Content-Type": "application/json" },
		});
	});
});

describe("manifest type shapes", () => {
	it("should accept manifests with multiple panel types", async () => {
		const manifests = {
			manifests: [
				{
					name: "test-plugin",
					version: "0.1.0",
					description: "Test",
					capabilities: ["ui"],
					webui: {
						panels: [
							{ id: "status", title: "Status", type: "status", endpoints: ["/healthz"] },
							{ id: "config", title: "Config", type: "config", configFields: ["apiKey"] },
							{ id: "logs", title: "Logs", type: "logs" },
							{ id: "metrics", title: "Metrics", type: "metrics", endpoints: ["/metrics"], pollIntervalMs: 5000 },
							{ id: "custom", title: "Custom", type: "custom", component: "/components/my-panel.js" },
						],
						routes: [{ path: "/plugins/test/dashboard", title: "Dashboard", component: "/dashboard.js" }],
					},
				},
			],
		};
		mockFetch.mockResolvedValue(mockJsonResponse(manifests));

		const result = await api.getPluginManifests();
		const plugin = result.manifests[0];

		expect(plugin.webui?.panels).toHaveLength(5);
		expect(plugin.webui?.routes).toHaveLength(1);

		const panelTypes = plugin.webui!.panels!.map((p) => p.type);
		expect(panelTypes).toEqual(["status", "config", "logs", "metrics", "custom"]);
	});

	it("should handle manifests without webui section", async () => {
		const manifests = {
			manifests: [
				{
					name: "headless-plugin",
					version: "1.0.0",
					description: "No UI",
					capabilities: ["storage"],
				},
			],
		};
		mockFetch.mockResolvedValue(mockJsonResponse(manifests));

		const result = await api.getPluginManifests();
		expect(result.manifests[0].webui).toBeUndefined();
	});

	it("should handle manifests with configSchema for config panels", async () => {
		const manifests = {
			manifests: [
				{
					name: "config-plugin",
					version: "1.0.0",
					description: "Has config",
					capabilities: ["channel"],
					configSchema: {
						title: "Config Plugin Settings",
						fields: [
							{ name: "apiKey", type: "password", label: "API Key", required: true, secret: true },
							{
								name: "region",
								type: "select",
								label: "Region",
								options: [
									{ value: "us", label: "US" },
									{ value: "eu", label: "EU" },
								],
							},
							{ name: "debug", type: "boolean", label: "Debug Mode" },
						],
					},
					webui: {
						panels: [{ id: "cfg", title: "Settings", type: "config", configFields: ["apiKey", "region"] }],
					},
				},
			],
		};
		mockFetch.mockResolvedValue(mockJsonResponse(manifests));

		const result = await api.getPluginManifests();
		const plugin = result.manifests[0];

		expect(plugin.configSchema?.fields).toHaveLength(3);
		expect(plugin.webui?.panels?.[0].configFields).toEqual(["apiKey", "region"]);
	});
});
