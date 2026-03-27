import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	type AuthContext,
	type WebMCPRegistry,
	type WebMCPTool,
	registerSlackTools,
} from "../src/webmcp-slack.js";

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function mockJsonResponse(data: unknown, ok = true, status = 200) {
	return {
		ok,
		status,
		json: vi.fn().mockResolvedValue(data),
	};
}

/** Simple in-memory registry for testing (mirrors WebMCPRegistry interface). */
function createTestRegistry(): WebMCPRegistry {
	const tools = new Map<string, WebMCPTool>();
	return {
		register(tool: WebMCPTool) {
			tools.set(tool.name, tool);
		},
		get(name: string) {
			return tools.get(name);
		},
		list() {
			return Array.from(tools.keys());
		},
	};
}

/** Retrieve a tool from the registry, throwing if it is missing. */
function getTool(registry: WebMCPRegistry, name: string) {
	const tool = registry.get(name);
	if (!tool) throw new Error(`Tool "${name}" not registered`);
	return tool;
}

describe("registerSlackTools", () => {
	let registry: WebMCPRegistry;
	const API_BASE = "/api";

	beforeEach(() => {
		registry = createTestRegistry();
		mockFetch.mockReset();
	});

	it("should register all 4 tools", () => {
		registerSlackTools(registry, API_BASE);

		const names = registry.list();
		expect(names).toHaveLength(4);
		expect(names).toContain("getSlackStatus");
		expect(names).toContain("listWorkspaces");
		expect(names).toContain("listSlackChannels");
		expect(names).toContain("getSlackMessageStats");
	});

	it("should use default apiBase when not provided", () => {
		registerSlackTools(registry);

		expect(registry.list()).toHaveLength(4);
	});

	describe("getSlackStatus", () => {
		it("should GET /plugins/wopr-plugin-slack/health", async () => {
			const response = {
				name: "wopr-plugin-slack",
				installed: true,
				enabled: true,
				loaded: true,
			};
			mockFetch.mockResolvedValue(mockJsonResponse(response));
			registerSlackTools(registry, API_BASE);

			const tool = getTool(registry, "getSlackStatus");
			const result = await tool.handler({}, {});

			expect(mockFetch).toHaveBeenCalledWith(
				"/api/plugins/wopr-plugin-slack/health",
				expect.any(Object),
			);
			expect(result).toEqual(response);
		});

		it("should include bearer token when auth.token is present", async () => {
			mockFetch.mockResolvedValue(mockJsonResponse({ loaded: true }));
			registerSlackTools(registry, API_BASE);

			const tool = getTool(registry, "getSlackStatus");
			const auth: AuthContext = { token: "my-secret-token" };
			await tool.handler({}, auth);

			const headers = mockFetch.mock.calls[0][1].headers;
			expect(headers.Authorization).toBe("Bearer my-secret-token");
		});

		it("should not include Authorization header when no token", async () => {
			mockFetch.mockResolvedValue(mockJsonResponse({ loaded: true }));
			registerSlackTools(registry, API_BASE);

			const tool = getTool(registry, "getSlackStatus");
			await tool.handler({}, {});

			const headers = mockFetch.mock.calls[0][1].headers;
			expect(headers.Authorization).toBeUndefined();
		});
	});

	describe("listWorkspaces", () => {
		it("should GET /plugins/wopr-plugin-slack/health and extract workspace data", async () => {
			const response = {
				name: "wopr-plugin-slack",
				installed: true,
				loaded: true,
				connected: true,
				workspaces: [{ id: "T123", name: "test-ws" }],
			};
			mockFetch.mockResolvedValue(mockJsonResponse(response));
			registerSlackTools(registry, API_BASE);

			const tool = getTool(registry, "listWorkspaces");
			const result = await tool.handler({}, {});

			expect(mockFetch).toHaveBeenCalledWith(
				"/api/plugins/wopr-plugin-slack/health",
				expect.any(Object),
			);
			expect(result).toEqual({
				workspaces: [{ id: "T123", name: "test-ws" }],
				connected: true,
			});
		});

		it("should include bearer token in auth header", async () => {
			mockFetch.mockResolvedValue(mockJsonResponse({}));
			registerSlackTools(registry, API_BASE);

			const tool = getTool(registry, "listWorkspaces");
			await tool.handler({}, { token: "tok-ws" });

			const headers = mockFetch.mock.calls[0][1].headers;
			expect(headers.Authorization).toBe("Bearer tok-ws");
		});
	});

	describe("listSlackChannels", () => {
		it("should GET /plugins/wopr-plugin-slack/channels", async () => {
			const channels = { channels: [{ name: "general" }, { name: "random" }] };
			mockFetch.mockResolvedValue(mockJsonResponse(channels));
			registerSlackTools(registry, API_BASE);

			const tool = getTool(registry, "listSlackChannels");
			const result = await tool.handler({}, {});

			expect(mockFetch).toHaveBeenCalledWith(
				"/api/plugins/wopr-plugin-slack/channels",
				expect.any(Object),
			);
			expect(result).toEqual(channels);
		});

		it("should append workspace query parameter when provided", async () => {
			mockFetch.mockResolvedValue(mockJsonResponse({ channels: [] }));
			registerSlackTools(registry, API_BASE);

			const tool = getTool(registry, "listSlackChannels");
			await tool.handler({ workspaceId: "my-workspace" }, {});

			expect(mockFetch).toHaveBeenCalledWith(
				"/api/plugins/wopr-plugin-slack/channels?workspace=my-workspace",
				expect.any(Object),
			);
		});

		it("should URL-encode workspace parameter with special characters", async () => {
			mockFetch.mockResolvedValue(mockJsonResponse({ channels: [] }));
			registerSlackTools(registry, API_BASE);

			const tool = getTool(registry, "listSlackChannels");
			await tool.handler({ workspaceId: "workspace with spaces" }, {});

			expect(mockFetch).toHaveBeenCalledWith(
				"/api/plugins/wopr-plugin-slack/channels?workspace=workspace%20with%20spaces",
				expect.any(Object),
			);
		});

		it("should not append workspace param when omitted", async () => {
			mockFetch.mockResolvedValue(mockJsonResponse({ channels: [] }));
			registerSlackTools(registry, API_BASE);

			const tool = getTool(registry, "listSlackChannels");
			await tool.handler({}, {});

			expect(mockFetch).toHaveBeenCalledWith(
				"/api/plugins/wopr-plugin-slack/channels",
				expect.any(Object),
			);
		});

		it("should include bearer token in auth header", async () => {
			mockFetch.mockResolvedValue(mockJsonResponse({ channels: [] }));
			registerSlackTools(registry, API_BASE);

			const tool = getTool(registry, "listSlackChannels");
			await tool.handler({}, { token: "tok-ch" });

			const headers = mockFetch.mock.calls[0][1].headers;
			expect(headers.Authorization).toBe("Bearer tok-ch");
		});
	});

	describe("getSlackMessageStats", () => {
		it("should GET /plugins/wopr-plugin-slack/stats", async () => {
			const stats = { messagesProcessed: 42, activeConversations: 3 };
			mockFetch.mockResolvedValue(mockJsonResponse(stats));
			registerSlackTools(registry, API_BASE);

			const tool = getTool(registry, "getSlackMessageStats");
			const result = await tool.handler({}, {});

			expect(mockFetch).toHaveBeenCalledWith(
				"/api/plugins/wopr-plugin-slack/stats",
				expect.any(Object),
			);
			expect(result).toEqual(stats);
		});

		it("should include bearer token in auth header", async () => {
			mockFetch.mockResolvedValue(
				mockJsonResponse({ messagesProcessed: 0 }),
			);
			registerSlackTools(registry, API_BASE);

			const tool = getTool(registry, "getSlackMessageStats");
			await tool.handler({}, { token: "tok-stats" });

			const headers = mockFetch.mock.calls[0][1].headers;
			expect(headers.Authorization).toBe("Bearer tok-stats");
		});
	});

	describe("error handling", () => {
		it("should throw on non-ok response with error from body", async () => {
			mockFetch.mockResolvedValue(
				mockJsonResponse({ error: "Plugin not found" }, false, 404),
			);
			registerSlackTools(registry, API_BASE);

			const tool = getTool(registry, "getSlackStatus");

			await expect(tool.handler({}, {})).rejects.toThrow("Plugin not found");
		});

		it("should throw generic error when body has no error field", async () => {
			mockFetch.mockResolvedValue(mockJsonResponse({}, false, 500));
			registerSlackTools(registry, API_BASE);

			const tool = getTool(registry, "getSlackMessageStats");

			await expect(tool.handler({}, {})).rejects.toThrow(
				"Request failed (500)",
			);
		});

		it("should throw generic error when body is not JSON", async () => {
			mockFetch.mockResolvedValue({
				ok: false,
				status: 502,
				json: vi.fn().mockRejectedValue(new Error("not json")),
			});
			registerSlackTools(registry, API_BASE);

			const tool = getTool(registry, "listWorkspaces");

			await expect(tool.handler({}, {})).rejects.toThrow("Request failed");
		});
	});

	describe("tool metadata", () => {
		it("getSlackStatus should have empty parameters", () => {
			registerSlackTools(registry, API_BASE);
			const tool = getTool(registry, "getSlackStatus");

			expect(tool.parameters).toEqual({});
		});

		it("listWorkspaces should have empty parameters", () => {
			registerSlackTools(registry, API_BASE);
			const tool = getTool(registry, "listWorkspaces");

			expect(tool.parameters).toEqual({});
		});

		it("listSlackChannels should have optional workspaceId parameter", () => {
			registerSlackTools(registry, API_BASE);
			const tool = getTool(registry, "listSlackChannels");

			expect(tool.parameters?.workspaceId?.type).toBe("string");
			expect(tool.parameters?.workspaceId?.required).toBe(false);
		});

		it("getSlackMessageStats should have empty parameters", () => {
			registerSlackTools(registry, API_BASE);
			const tool = getTool(registry, "getSlackMessageStats");

			expect(tool.parameters).toEqual({});
		});
	});

	describe("custom apiBase", () => {
		it("should use custom apiBase for all requests", async () => {
			mockFetch.mockResolvedValue(mockJsonResponse({ loaded: true }));
			registerSlackTools(registry, "http://localhost:7437/api");

			const tool = getTool(registry, "getSlackStatus");
			await tool.handler({}, {});

			expect(mockFetch).toHaveBeenCalledWith(
				"http://localhost:7437/api/plugins/wopr-plugin-slack/health",
				expect.any(Object),
			);
		});
	});
});
