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

describe("api.getPlugins (typed)", () => {
	it("should GET /api/plugins and return typed plugins", async () => {
		const plugins = {
			plugins: [
				{
					id: "discord",
					name: "@wopr-network/plugin-discord",
					version: "1.0.0",
					enabled: true,
					healthy: true,
					category: "channel",
				},
			],
		};
		mockFetch.mockResolvedValue(mockJsonResponse(plugins));

		const result = await api.getPlugins();

		expect(mockFetch).toHaveBeenCalledWith("/api/plugins", {
			headers: { "Content-Type": "application/json" },
		});
		expect(result.plugins[0].id).toBe("discord");
		expect(result.plugins[0].enabled).toBe(true);
	});
});

describe("api.getAvailablePlugins", () => {
	it("should GET /api/plugins/available", async () => {
		const available = {
			plugins: [
				{
					name: "@wopr-network/plugin-voice",
					description: "Voice channel support",
					version: "0.5.0",
					category: "voice",
				},
			],
		};
		mockFetch.mockResolvedValue(mockJsonResponse(available));

		const result = await api.getAvailablePlugins();

		expect(mockFetch).toHaveBeenCalledWith("/api/plugins/available", {
			headers: { "Content-Type": "application/json" },
		});
		expect(result.plugins).toHaveLength(1);
		expect(result.plugins[0].name).toBe("@wopr-network/plugin-voice");
	});
});

describe("api.installPlugin", () => {
	it("should POST /api/plugins/install with plugin name", async () => {
		const installed = {
			plugin: {
				id: "voice",
				name: "@wopr-network/plugin-voice",
				version: "0.5.0",
				enabled: true,
				healthy: true,
			},
		};
		mockFetch.mockResolvedValue(mockJsonResponse(installed));

		const result = await api.installPlugin("@wopr-network/plugin-voice");

		expect(mockFetch).toHaveBeenCalledWith("/api/plugins/install", {
			method: "POST",
			body: JSON.stringify({ name: "@wopr-network/plugin-voice" }),
			headers: { "Content-Type": "application/json" },
		});
		expect(result.plugin.id).toBe("voice");
	});
});

describe("api.uninstallPlugin", () => {
	it("should POST /api/plugins/uninstall with plugin id", async () => {
		mockFetch.mockResolvedValue(mockJsonResponse({}));

		await api.uninstallPlugin("voice");

		expect(mockFetch).toHaveBeenCalledWith("/api/plugins/uninstall", {
			method: "POST",
			body: JSON.stringify({ id: "voice" }),
			headers: { "Content-Type": "application/json" },
		});
	});
});

describe("api.enablePlugin", () => {
	it("should POST /api/plugins/:id/enable", async () => {
		mockFetch.mockResolvedValue(mockJsonResponse({}));

		await api.enablePlugin("discord");

		expect(mockFetch).toHaveBeenCalledWith("/api/plugins/discord/enable", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
		});
	});

	it("should encode special characters in plugin id", async () => {
		mockFetch.mockResolvedValue(mockJsonResponse({}));

		await api.enablePlugin("plugin with spaces");

		expect(mockFetch).toHaveBeenCalledWith("/api/plugins/plugin%20with%20spaces/enable", expect.any(Object));
	});
});

describe("api.disablePlugin", () => {
	it("should POST /api/plugins/:id/disable", async () => {
		mockFetch.mockResolvedValue(mockJsonResponse({}));

		await api.disablePlugin("discord");

		expect(mockFetch).toHaveBeenCalledWith("/api/plugins/discord/disable", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
		});
	});
});

describe("api.getPluginConfig", () => {
	it("should GET /api/plugins/:id/config", async () => {
		const config = { token: "abc123", guildId: "12345" };
		mockFetch.mockResolvedValue(mockJsonResponse(config));

		const result = await api.getPluginConfig("discord");

		expect(mockFetch).toHaveBeenCalledWith("/api/plugins/discord/config", {
			headers: { "Content-Type": "application/json" },
		});
		expect(result).toEqual(config);
	});
});

describe("api.updatePluginConfig", () => {
	it("should PUT /api/plugins/:id/config with config values", async () => {
		mockFetch.mockResolvedValue(mockJsonResponse({}));

		const config = { token: "new-token", guildId: "99999" };
		await api.updatePluginConfig("discord", config);

		expect(mockFetch).toHaveBeenCalledWith("/api/plugins/discord/config", {
			method: "PUT",
			body: JSON.stringify(config),
			headers: { "Content-Type": "application/json" },
		});
	});

	it("should encode special characters in plugin id", async () => {
		mockFetch.mockResolvedValue(mockJsonResponse({}));

		await api.updatePluginConfig("my plugin", { key: "val" });

		expect(mockFetch).toHaveBeenCalledWith("/api/plugins/my%20plugin/config", expect.any(Object));
	});
});
