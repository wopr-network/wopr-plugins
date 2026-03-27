import { beforeEach, describe, expect, it, vi } from "vitest";
import { type AuthContext, type WebMCPRegistry, registerImessageTools } from "../src/webmcp-imessage.js";

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

function createRegistry(): WebMCPRegistry {
  const tools = new Map<string, { name: string; handler: Function; [k: string]: unknown }>();
  return {
    register(tool: { name: string; handler: Function }) {
      tools.set(tool.name, tool);
    },
    get(name: string) {
      return tools.get(name) as any;
    },
    list() {
      return [...tools.keys()];
    },
  };
}

function getTool(registry: WebMCPRegistry, name: string) {
  const tool = registry.get(name);
  if (!tool) throw new Error(`Tool "${name}" not registered`);
  return tool;
}

describe("registerImessageTools", () => {
  let registry: WebMCPRegistry;
  const API_BASE = "/api";

  beforeEach(() => {
    registry = createRegistry();
    mockFetch.mockReset();
  });

  it("should register all 3 tools", () => {
    registerImessageTools(registry, API_BASE);

    const names = registry.list();
    expect(names).toHaveLength(3);
    expect(names).toContain("getImessageStatus");
    expect(names).toContain("listImessageChats");
    expect(names).toContain("getImessageMessageStats");
  });

  it("should use default apiBase when not provided", () => {
    registerImessageTools(registry);

    expect(registry.list()).toHaveLength(3);
  });

  describe("getImessageStatus", () => {
    it("should GET /plugins/imessage/status", async () => {
      const status = { connected: true, service: "imessage", platform: "darwin" };
      mockFetch.mockResolvedValue(mockJsonResponse(status));
      registerImessageTools(registry, API_BASE);

      const tool = getTool(registry, "getImessageStatus");
      const result = await tool.handler({}, {});

      expect(mockFetch).toHaveBeenCalledWith("/api/plugins/imessage/status", expect.any(Object));
      expect(result).toEqual(status);
    });

    it("should include bearer token when auth.token is present", async () => {
      mockFetch.mockResolvedValue(mockJsonResponse({ connected: true }));
      registerImessageTools(registry, API_BASE);

      const tool = getTool(registry, "getImessageStatus");
      const auth: AuthContext = { token: "my-token" };
      await tool.handler({}, auth);

      const headers = mockFetch.mock.calls[0][1].headers;
      expect(headers.Authorization).toBe("Bearer my-token");
    });

    it("should not include Authorization header when no token", async () => {
      mockFetch.mockResolvedValue(mockJsonResponse({ connected: false }));
      registerImessageTools(registry, API_BASE);

      const tool = getTool(registry, "getImessageStatus");
      await tool.handler({}, {});

      const headers = mockFetch.mock.calls[0][1].headers;
      expect(headers.Authorization).toBeUndefined();
    });

    it("should not expose Apple ID credentials", async () => {
      const status = { connected: true, service: "imessage", platform: "darwin" };
      mockFetch.mockResolvedValue(mockJsonResponse(status));
      registerImessageTools(registry, API_BASE);

      const tool = getTool(registry, "getImessageStatus");
      const result = await tool.handler({}, {}) as Record<string, unknown>;

      // Verify no credential fields in the response
      expect(result).not.toHaveProperty("appleId");
      expect(result).not.toHaveProperty("password");
      expect(result).not.toHaveProperty("credentials");
    });
  });

  describe("listImessageChats", () => {
    it("should GET /plugins/imessage/chats", async () => {
      const chats = { chats: [{ id: 1, name: "John Doe", service: "iMessage" }] };
      mockFetch.mockResolvedValue(mockJsonResponse(chats));
      registerImessageTools(registry, API_BASE);

      const tool = getTool(registry, "listImessageChats");
      const result = await tool.handler({}, {});

      expect(mockFetch).toHaveBeenCalledWith("/api/plugins/imessage/chats", expect.any(Object));
      expect(result).toEqual(chats);
    });

    it("should pass limit query parameter when provided", async () => {
      mockFetch.mockResolvedValue(mockJsonResponse({ chats: [] }));
      registerImessageTools(registry, API_BASE);

      const tool = getTool(registry, "listImessageChats");
      await tool.handler({ limit: 10 }, {});

      expect(mockFetch).toHaveBeenCalledWith("/api/plugins/imessage/chats?limit=10", expect.any(Object));
    });

    it("should not include limit query parameter when not provided", async () => {
      mockFetch.mockResolvedValue(mockJsonResponse({ chats: [] }));
      registerImessageTools(registry, API_BASE);

      const tool = getTool(registry, "listImessageChats");
      await tool.handler({}, {});

      expect(mockFetch).toHaveBeenCalledWith("/api/plugins/imessage/chats", expect.any(Object));
    });

    it("should include bearer token in auth header", async () => {
      mockFetch.mockResolvedValue(mockJsonResponse({ chats: [] }));
      registerImessageTools(registry, API_BASE);

      const tool = getTool(registry, "listImessageChats");
      await tool.handler({}, { token: "tok-chats" });

      const headers = mockFetch.mock.calls[0][1].headers;
      expect(headers.Authorization).toBe("Bearer tok-chats");
    });
  });

  describe("getImessageMessageStats", () => {
    it("should GET /plugins/imessage/stats", async () => {
      const stats = { messagesQueued: 2, activeConversations: 5 };
      mockFetch.mockResolvedValue(mockJsonResponse(stats));
      registerImessageTools(registry, API_BASE);

      const tool = getTool(registry, "getImessageMessageStats");
      const result = await tool.handler({}, {});

      expect(mockFetch).toHaveBeenCalledWith("/api/plugins/imessage/stats", expect.any(Object));
      expect(result).toEqual(stats);
    });

    it("should include bearer token in auth header", async () => {
      mockFetch.mockResolvedValue(mockJsonResponse({ messagesQueued: 0 }));
      registerImessageTools(registry, API_BASE);

      const tool = getTool(registry, "getImessageMessageStats");
      await tool.handler({}, { token: "tok-stats" });

      const headers = mockFetch.mock.calls[0][1].headers;
      expect(headers.Authorization).toBe("Bearer tok-stats");
    });
  });

  describe("error handling", () => {
    it("should throw on non-ok response with error from body", async () => {
      mockFetch.mockResolvedValue(mockJsonResponse({ error: "iMessage plugin not loaded" }, false, 404));
      registerImessageTools(registry, API_BASE);

      const tool = getTool(registry, "getImessageStatus");

      await expect(tool.handler({}, {})).rejects.toThrow("iMessage plugin not loaded");
    });

    it("should throw with status code when body has no error field", async () => {
      mockFetch.mockResolvedValue(mockJsonResponse({}, false, 500));
      registerImessageTools(registry, API_BASE);

      const tool = getTool(registry, "listImessageChats");

      await expect(tool.handler({}, {})).rejects.toThrow("Request failed (500)");
    });

    it("should handle json parse failure on error response", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 502,
        json: vi.fn().mockRejectedValue(new Error("invalid json")),
      });
      registerImessageTools(registry, API_BASE);

      const tool = getTool(registry, "getImessageMessageStats");

      await expect(tool.handler({}, {})).rejects.toThrow("Request failed");
    });
  });

  describe("tool metadata", () => {
    it("all tools should be read-only (no write parameters)", () => {
      registerImessageTools(registry, API_BASE);

      const statusTool = getTool(registry, "getImessageStatus");
      const chatsTool = getTool(registry, "listImessageChats");
      const statsTool = getTool(registry, "getImessageMessageStats");

      // Status and stats have no parameters
      expect(Object.keys(statusTool.parameters)).toHaveLength(0);
      expect(Object.keys(statsTool.parameters)).toHaveLength(0);

      // Chats only has optional limit
      expect(Object.keys(chatsTool.parameters)).toHaveLength(1);
      expect(chatsTool.parameters.limit.required).toBe(false);
    });

    it("all tools should have descriptions", () => {
      registerImessageTools(registry, API_BASE);

      const statusTool = getTool(registry, "getImessageStatus");
      const chatsTool = getTool(registry, "listImessageChats");
      const statsTool = getTool(registry, "getImessageMessageStats");

      expect(statusTool.description).toBeTruthy();
      expect(chatsTool.description).toBeTruthy();
      expect(statsTool.description).toBeTruthy();
    });
  });
});
