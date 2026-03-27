import { beforeEach, describe, expect, it, vi } from "vitest";
import { type ModelContextClient, WebMCPRegistry } from "../src/lib/webmcp";
import { registerConversationTools } from "../src/lib/webmcp-conversation";

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

const mockClient: ModelContextClient = {
	requestUserInteraction: vi.fn(),
};

/** Retrieve a tool from the registry, throwing if it is missing. */
function getTool(registry: WebMCPRegistry, name: string) {
	const tool = registry.get(name);
	if (!tool) throw new Error(`Tool "${name}" not registered`);
	return tool;
}

describe("registerConversationTools", () => {
	let registry: WebMCPRegistry;
	const API_BASE = "/api";

	beforeEach(() => {
		registry = new WebMCPRegistry();
		mockFetch.mockReset();
	});

	it("should register all 5 tools", () => {
		registerConversationTools(registry, API_BASE);

		const names = registry.list();
		expect(names).toHaveLength(5);
		expect(names).toContain("sendMessage");
		expect(names).toContain("getConversation");
		expect(names).toContain("listSessions");
		expect(names).toContain("newSession");
		expect(names).toContain("getStatus");
	});

	it("should use default apiBase when not provided", () => {
		registerConversationTools(registry);

		expect(registry.list()).toHaveLength(5);
	});

	describe("sendMessage", () => {
		it("should POST to /sessions/:session/inject", async () => {
			const response = { session: "default", response: "Hello!" };
			mockFetch.mockResolvedValue(mockJsonResponse(response));
			registerConversationTools(registry, API_BASE);

			const tool = getTool(registry, "sendMessage");
			const result = await tool.execute({ text: "Hello", sessionId: "my-session" }, mockClient);

			expect(mockFetch).toHaveBeenCalledWith(
				"/api/sessions/my-session/inject",
				expect.objectContaining({
					method: "POST",
					body: JSON.stringify({ message: "Hello" }),
				}),
			);
			expect(result).toEqual(response);
		});

		it("should default to 'default' session when sessionId is omitted", async () => {
			mockFetch.mockResolvedValue(mockJsonResponse({ response: "ok" }));
			registerConversationTools(registry, API_BASE);

			const tool = getTool(registry, "sendMessage");
			await tool.execute({ text: "Hi" }, mockClient);

			expect(mockFetch).toHaveBeenCalledWith("/api/sessions/default/inject", expect.any(Object));
		});

		it("should throw when text parameter is missing", async () => {
			registerConversationTools(registry, API_BASE);

			const tool = getTool(registry, "sendMessage");

			await expect(tool.execute({}, mockClient)).rejects.toThrow("Parameter 'text' is required");
		});

		it("should include bearer token when auth has token set on registry", async () => {
			mockFetch.mockResolvedValue(mockJsonResponse({ response: "ok" }));
			registry.setAuthContext({ token: "my-secret-token" });
			registerConversationTools(registry, API_BASE);

			const tool = getTool(registry, "sendMessage");
			await tool.execute({ text: "Hi" }, mockClient);

			const headers = mockFetch.mock.calls[0][1].headers;
			expect(headers.Authorization).toBe("Bearer my-secret-token");
		});

		it("should not include Authorization header when no token", async () => {
			mockFetch.mockResolvedValue(mockJsonResponse({ response: "ok" }));
			registerConversationTools(registry, API_BASE);

			const tool = getTool(registry, "sendMessage");
			await tool.execute({ text: "Hi" }, mockClient);

			const headers = mockFetch.mock.calls[0][1].headers;
			expect(headers.Authorization).toBeUndefined();
		});

		it("should encode special characters in session name", async () => {
			mockFetch.mockResolvedValue(mockJsonResponse({ response: "ok" }));
			registerConversationTools(registry, API_BASE);

			const tool = getTool(registry, "sendMessage");
			await tool.execute({ text: "Hi", sessionId: "session with spaces" }, mockClient);

			expect(mockFetch).toHaveBeenCalledWith("/api/sessions/session%20with%20spaces/inject", expect.any(Object));
		});

		it("should have readOnlyHint set to false", () => {
			registerConversationTools(registry, API_BASE);
			const tool = getTool(registry, "sendMessage");
			expect(tool.annotations?.readOnlyHint).toBe(false);
		});
	});

	describe("getConversation", () => {
		it("should GET /sessions/:sessionId/history", async () => {
			const history = { messages: [{ role: "user", content: "hi" }] };
			mockFetch.mockResolvedValue(mockJsonResponse(history));
			registerConversationTools(registry, API_BASE);

			const tool = getTool(registry, "getConversation");
			const result = await tool.execute({ sessionId: "my-session" }, mockClient);

			expect(mockFetch).toHaveBeenCalledWith("/api/sessions/my-session/history", expect.any(Object));
			expect(result).toEqual(history);
		});

		it("should append limit query parameter when provided", async () => {
			mockFetch.mockResolvedValue(mockJsonResponse({ messages: [] }));
			registerConversationTools(registry, API_BASE);

			const tool = getTool(registry, "getConversation");
			await tool.execute({ sessionId: "s1", limit: 10 }, mockClient);

			expect(mockFetch).toHaveBeenCalledWith("/api/sessions/s1/history?limit=10", expect.any(Object));
		});

		it("should throw when sessionId is missing", async () => {
			registerConversationTools(registry, API_BASE);

			const tool = getTool(registry, "getConversation");

			await expect(tool.execute({}, mockClient)).rejects.toThrow("Parameter 'sessionId' is required");
		});

		it("should include bearer token in auth header", async () => {
			mockFetch.mockResolvedValue(mockJsonResponse({ messages: [] }));
			registry.setAuthContext({ token: "tok-123" });
			registerConversationTools(registry, API_BASE);

			const tool = getTool(registry, "getConversation");
			await tool.execute({ sessionId: "s1" }, mockClient);

			const headers = mockFetch.mock.calls[0][1].headers;
			expect(headers.Authorization).toBe("Bearer tok-123");
		});

		it("should have readOnlyHint set to true", () => {
			registerConversationTools(registry, API_BASE);
			const tool = getTool(registry, "getConversation");
			expect(tool.annotations?.readOnlyHint).toBe(true);
		});
	});

	describe("listSessions", () => {
		it("should GET /sessions", async () => {
			const sessions = { sessions: [{ name: "default" }, { name: "s2" }] };
			mockFetch.mockResolvedValue(mockJsonResponse(sessions));
			registerConversationTools(registry, API_BASE);

			const tool = getTool(registry, "listSessions");
			const result = await tool.execute({}, mockClient);

			expect(mockFetch).toHaveBeenCalledWith("/api/sessions", expect.any(Object));
			expect(result).toEqual(sessions);
		});

		it("should include bearer token in auth header", async () => {
			mockFetch.mockResolvedValue(mockJsonResponse({ sessions: [] }));
			registry.setAuthContext({ token: "tok-abc" });
			registerConversationTools(registry, API_BASE);

			const tool = getTool(registry, "listSessions");
			await tool.execute({}, mockClient);

			const headers = mockFetch.mock.calls[0][1].headers;
			expect(headers.Authorization).toBe("Bearer tok-abc");
		});

		it("should have readOnlyHint set to true", () => {
			registerConversationTools(registry, API_BASE);
			const tool = getTool(registry, "listSessions");
			expect(tool.annotations?.readOnlyHint).toBe(true);
		});
	});

	describe("newSession", () => {
		it("should POST /sessions with generated name", async () => {
			const session = { name: "session-1234", id: "abc" };
			mockFetch.mockResolvedValue(mockJsonResponse(session));
			registerConversationTools(registry, API_BASE);

			const tool = getTool(registry, "newSession");
			const result = await tool.execute({}, mockClient);

			expect(mockFetch).toHaveBeenCalledWith("/api/sessions", expect.objectContaining({ method: "POST" }));
			const body = JSON.parse(mockFetch.mock.calls[0][1].body);
			expect(body.name).toMatch(/^session-\d+$/);
			expect(body.context).toBeUndefined();
			expect(result).toEqual(session);
		});

		it("should include model context when model param is provided", async () => {
			mockFetch.mockResolvedValue(mockJsonResponse({ name: "s1" }));
			registerConversationTools(registry, API_BASE);

			const tool = getTool(registry, "newSession");
			await tool.execute({ model: "claude-sonnet-4-5-20250929" }, mockClient);

			const body = JSON.parse(mockFetch.mock.calls[0][1].body);
			expect(body.context).toBe("Use model: claude-sonnet-4-5-20250929");
		});

		it("should include bearer token in auth header", async () => {
			mockFetch.mockResolvedValue(mockJsonResponse({ name: "s1" }));
			registry.setAuthContext({ token: "tok-xyz" });
			registerConversationTools(registry, API_BASE);

			const tool = getTool(registry, "newSession");
			await tool.execute({}, mockClient);

			const headers = mockFetch.mock.calls[0][1].headers;
			expect(headers.Authorization).toBe("Bearer tok-xyz");
		});

		it("should have readOnlyHint set to false", () => {
			registerConversationTools(registry, API_BASE);
			const tool = getTool(registry, "newSession");
			expect(tool.annotations?.readOnlyHint).toBe(false);
		});
	});

	describe("getStatus", () => {
		it("should GET /status", async () => {
			const status = {
				healthy: true,
				plugins: ["discord"],
				uptime: 3600,
			};
			mockFetch.mockResolvedValue(mockJsonResponse(status));
			registerConversationTools(registry, API_BASE);

			const tool = getTool(registry, "getStatus");
			const result = await tool.execute({}, mockClient);

			expect(mockFetch).toHaveBeenCalledWith("/api/status", expect.any(Object));
			expect(result).toEqual(status);
		});

		it("should include bearer token in auth header", async () => {
			mockFetch.mockResolvedValue(mockJsonResponse({ healthy: true }));
			registry.setAuthContext({ token: "tok-status" });
			registerConversationTools(registry, API_BASE);

			const tool = getTool(registry, "getStatus");
			await tool.execute({}, mockClient);

			const headers = mockFetch.mock.calls[0][1].headers;
			expect(headers.Authorization).toBe("Bearer tok-status");
		});

		it("should have readOnlyHint set to true", () => {
			registerConversationTools(registry, API_BASE);
			const tool = getTool(registry, "getStatus");
			expect(tool.annotations?.readOnlyHint).toBe(true);
		});
	});

	describe("error handling", () => {
		it("should throw on non-ok response with error from body", async () => {
			mockFetch.mockResolvedValue(mockJsonResponse({ error: "Session not found" }, false, 404));
			registerConversationTools(registry, API_BASE);

			const tool = getTool(registry, "listSessions");

			await expect(tool.execute({}, mockClient)).rejects.toThrow("Session not found");
		});

		it("should throw generic error when body has no error field", async () => {
			mockFetch.mockResolvedValue(mockJsonResponse({}, false, 500));
			registerConversationTools(registry, API_BASE);

			const tool = getTool(registry, "getStatus");

			await expect(tool.execute({}, mockClient)).rejects.toThrow("Request failed (500)");
		});

		it("should throw generic error when body is not JSON", async () => {
			mockFetch.mockResolvedValue({
				ok: false,
				status: 502,
				json: vi.fn().mockRejectedValue(new Error("not json")),
			});
			registerConversationTools(registry, API_BASE);

			const tool = getTool(registry, "getStatus");

			await expect(tool.execute({}, mockClient)).rejects.toThrow("Request failed");
		});
	});

	describe("tool metadata (inputSchema and annotations)", () => {
		it("sendMessage should have correct inputSchema", () => {
			registerConversationTools(registry, API_BASE);
			const tool = getTool(registry, "sendMessage");

			expect(tool.inputSchema).toEqual({
				type: "object",
				properties: {
					text: { type: "string", description: "The message text to send" },
					sessionId: {
						type: "string",
						description: "Session name to send the message in. If omitted, uses the default session.",
					},
				},
				required: ["text"],
			});
		});

		it("getConversation should have correct inputSchema", () => {
			registerConversationTools(registry, API_BASE);
			const tool = getTool(registry, "getConversation");

			expect(tool.inputSchema).toEqual({
				type: "object",
				properties: {
					sessionId: {
						type: "string",
						description: "Session name to retrieve history for",
					},
					limit: {
						type: "number",
						description: "Maximum number of messages to return. Omit for all.",
					},
				},
				required: ["sessionId"],
			});
		});

		it("listSessions should have empty properties inputSchema", () => {
			registerConversationTools(registry, API_BASE);
			const tool = getTool(registry, "listSessions");

			expect(tool.inputSchema).toEqual({ type: "object", properties: {} });
		});

		it("newSession should have optional model in inputSchema", () => {
			registerConversationTools(registry, API_BASE);
			const tool = getTool(registry, "newSession");

			expect(tool.inputSchema).toEqual({
				type: "object",
				properties: {
					model: {
						type: "string",
						description:
							"Model identifier to use for this session (e.g. 'claude-sonnet-4-5-20250929'). Omit for default.",
					},
				},
			});
		});

		it("getStatus should have empty properties inputSchema", () => {
			registerConversationTools(registry, API_BASE);
			const tool = getTool(registry, "getStatus");

			expect(tool.inputSchema).toEqual({ type: "object", properties: {} });
		});
	});

	describe("custom apiBase", () => {
		it("should use custom apiBase for all requests", async () => {
			mockFetch.mockResolvedValue(mockJsonResponse({ sessions: [] }));
			registerConversationTools(registry, "http://localhost:7437/api");

			const tool = getTool(registry, "listSessions");
			await tool.execute({}, mockClient);

			expect(mockFetch).toHaveBeenCalledWith("http://localhost:7437/api/sessions", expect.any(Object));
		});
	});
});
