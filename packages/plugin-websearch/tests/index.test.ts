import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mock global fetch before any imports that use it
// ---------------------------------------------------------------------------
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// Mock node:net (used by isPrivateUrl for isIP)
vi.mock("node:net", () => ({
  isIP: (host: string) => {
    if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return 4;
    if (host.includes(":")) return 6;
    return 0;
  },
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------
import plugin, { isPrivateUrl } from "../src/index.js";
import { buildWebSearchA2ATools } from "../src/web-search.js";
import { BraveSearchProvider } from "../src/providers/brave.js";
import { GoogleSearchProvider } from "../src/providers/google.js";
import { XaiSearchProvider } from "../src/providers/xai.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function mockCtx() {
  return {
    storage: {
      register: vi.fn(),
      get: vi.fn(),
      set: vi.fn(),
      isRegistered: vi.fn().mockReturnValue(false),
    },
    registerA2AServer: vi.fn(),
    registerExtension: vi.fn(),
    registerConfigSchema: vi.fn(),
    log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
    getConfig: vi.fn().mockReturnValue({}),
  };
}

function mockOkResponse(body: unknown) {
  return Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  });
}

function mockErrorResponse(status: number, body: string) {
  return Promise.resolve({
    ok: false,
    status,
    json: () => Promise.reject(new Error("not json")),
    text: () => Promise.resolve(body),
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("wopr-plugin-websearch", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    delete process.env.GOOGLE_SEARCH_API_KEY;
    delete process.env.GOOGLE_SEARCH_CX;
    delete process.env.BRAVE_SEARCH_API_KEY;
    delete process.env.XAI_API_KEY;
  });

  afterEach(() => {
    delete process.env.GOOGLE_SEARCH_API_KEY;
    delete process.env.GOOGLE_SEARCH_CX;
    delete process.env.BRAVE_SEARCH_API_KEY;
    delete process.env.XAI_API_KEY;
  });

  // ---------------------------------------------------------------------------
  // Plugin lifecycle
  // ---------------------------------------------------------------------------
  describe("plugin lifecycle", () => {
    it("should have correct metadata", () => {
      expect(plugin.name).toBe("wopr-plugin-websearch");
      expect(plugin.version).toBe("1.0.0");
    });

    it("should register A2A server on init", async () => {
      const ctx = mockCtx();
      await plugin.init(ctx as any);
      expect(ctx.registerA2AServer).toHaveBeenCalledTimes(1);
      const serverConfig = ctx.registerA2AServer.mock.calls[0][0];
      expect(serverConfig.name).toBe("web-search");
      expect(serverConfig.tools).toHaveLength(1);
      expect(serverConfig.tools[0].name).toBe("web_search");
    });

    it("should log on init", async () => {
      const ctx = mockCtx();
      await plugin.init(ctx as any);
      expect(ctx.log.info).toHaveBeenCalledWith("Web search plugin initialized");
    });

    it("should skip registerA2AServer if not available", async () => {
      const ctx = mockCtx();
      ctx.registerA2AServer = undefined as any;
      await plugin.init(ctx as any);
    });

    it("should handle shutdown", async () => {
      await expect(plugin.shutdown!()).resolves.toBeUndefined();
    });

    it("should have a manifest with required fields", () => {
      expect(plugin.manifest).toBeDefined();
      expect(plugin.manifest!.name).toBe("@wopr-network/wopr-plugin-websearch");
      expect(plugin.manifest!.capabilities).toContain("web-search");
      expect(plugin.manifest!.category).toBe("search");
      expect(plugin.manifest!.tags).toEqual(expect.arrayContaining(["web-search", "brave", "google", "xai"]));
      expect(plugin.manifest!.icon).toBe("search");
      expect(plugin.manifest!.requires?.network?.outbound).toBe(true);
      expect(plugin.manifest!.provides?.capabilities).toHaveLength(1);
      expect(plugin.manifest!.provides?.capabilities[0].type).toBe("web-search");
      expect(plugin.manifest!.lifecycle?.shutdownBehavior).toBe("graceful");
    });

    it("should register config schema on init", async () => {
      const ctx = mockCtx();
      await plugin.init(ctx as any);
      expect(ctx.registerConfigSchema).toHaveBeenCalledTimes(1);
      expect(ctx.registerConfigSchema).toHaveBeenCalledWith(
        "wopr-plugin-websearch",
        expect.objectContaining({ title: "Web Search" }),
      );
    });

    it("should survive init-shutdown-init cycle", async () => {
      const ctx = mockCtx();
      await plugin.init(ctx as any);
      await plugin.shutdown!();
      // Second init should work cleanly
      await plugin.init(ctx as any);
      expect(ctx.registerA2AServer).toHaveBeenCalledTimes(2);
      expect(ctx.registerConfigSchema).toHaveBeenCalledTimes(2);
    });
  });

  // ---------------------------------------------------------------------------
  // SSRF protection
  // ---------------------------------------------------------------------------
  describe("isPrivateUrl", () => {
    it("should block localhost", () => {
      expect(isPrivateUrl("http://localhost/path")).toBe(true);
      expect(isPrivateUrl("http://127.0.0.1/path")).toBe(true);
      expect(isPrivateUrl("http://0.0.0.0/")).toBe(true);
    });

    it("should block private RFC1918 addresses", () => {
      expect(isPrivateUrl("http://10.0.0.1/")).toBe(true);
      expect(isPrivateUrl("http://172.16.0.1/")).toBe(true);
      expect(isPrivateUrl("http://172.31.255.255/")).toBe(true);
      expect(isPrivateUrl("http://192.168.1.1/")).toBe(true);
    });

    it("should block link-local addresses", () => {
      expect(isPrivateUrl("http://169.254.169.254/")).toBe(true);
    });

    it("should block cloud metadata endpoint", () => {
      expect(isPrivateUrl("http://metadata.google.internal/")).toBe(true);
    });

    it("should block non-http protocols", () => {
      expect(isPrivateUrl("ftp://example.com/file")).toBe(true);
      expect(isPrivateUrl("file:///etc/passwd")).toBe(true);
    });

    it("should allow public URLs", () => {
      expect(isPrivateUrl("https://www.google.com")).toBe(false);
      expect(isPrivateUrl("https://example.com/path?q=test")).toBe(false);
      expect(isPrivateUrl("http://8.8.8.8/")).toBe(false);
    });

    it("should block IPv6 loopback", () => {
      expect(isPrivateUrl("http://[::1]/")).toBe(true);
    });

    it("should block invalid URLs", () => {
      expect(isPrivateUrl("not-a-url")).toBe(true);
    });

    it("should block CGNAT range", () => {
      expect(isPrivateUrl("http://100.64.0.1/")).toBe(true);
    });

    it("should block benchmark range", () => {
      expect(isPrivateUrl("http://198.18.0.1/")).toBe(true);
      expect(isPrivateUrl("http://198.19.255.255/")).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // buildWebSearchA2ATools
  // ---------------------------------------------------------------------------
  describe("buildWebSearchA2ATools", () => {
    it("should return correct server config shape", () => {
      const config = buildWebSearchA2ATools({});
      expect(config.name).toBe("web-search");
      expect(config.version).toBe("1.0.0");
      expect(config.tools).toHaveLength(1);
    });

    it("should define web_search tool with correct schema", () => {
      const config = buildWebSearchA2ATools({});
      const tool = config.tools[0];
      expect(tool.name).toBe("web_search");
      expect(tool.inputSchema.required).toContain("query");
      expect(tool.inputSchema.properties).toHaveProperty("query");
      expect(tool.inputSchema.properties).toHaveProperty("count");
      expect(tool.inputSchema.properties).toHaveProperty("provider");
    });
  });

  // ---------------------------------------------------------------------------
  // web_search tool handler
  // ---------------------------------------------------------------------------
  describe("web_search handler", () => {
    it("should return error when no providers are configured", async () => {
      const config = buildWebSearchA2ATools({});
      const handler = config.tools[0].handler;
      const result = await handler({ query: "test query" });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("All search providers failed");
      expect(result.content[0].text).toContain("not configured");
    });

    it("should search with Google provider via env vars", async () => {
      process.env.GOOGLE_SEARCH_API_KEY = "test-key";
      process.env.GOOGLE_SEARCH_CX = "test-cx";

      mockFetch.mockReturnValueOnce(
        mockOkResponse({
          items: [
            { title: "Result 1", link: "https://example.com/1", snippet: "Snippet 1" },
            { title: "Result 2", link: "https://example.com/2", snippet: "Snippet 2" },
          ],
        })
      );

      const config = buildWebSearchA2ATools({});
      const handler = config.tools[0].handler;
      const result = await handler({ query: "test query", count: 5 });

      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.provider).toBe("google");
      expect(parsed.resultCount).toBe(2);
      expect(parsed.results[0].title).toBe("Result 1");
    });

    it("should search with Brave provider via env vars", async () => {
      process.env.BRAVE_SEARCH_API_KEY = "test-brave-key";

      mockFetch.mockReturnValueOnce(
        mockOkResponse({
          web: {
            results: [
              { title: "Brave Result", url: "https://brave.com/1", description: "Brave snippet" },
            ],
          },
        })
      );

      const config = buildWebSearchA2ATools({});
      const handler = config.tools[0].handler;
      const result = await handler({ query: "test", provider: "brave" });

      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.provider).toBe("brave");
      expect(parsed.results[0].title).toBe("Brave Result");
    });

    it("should search with xAI provider and parse citations", async () => {
      process.env.XAI_API_KEY = "test-xai-key";

      mockFetch.mockReturnValueOnce(
        mockOkResponse({
          citations: [
            { title: "xAI Result", url: "https://xai.com/1" },
          ],
          choices: [{ message: { content: "[]" } }],
        })
      );

      const config = buildWebSearchA2ATools({});
      const handler = config.tools[0].handler;
      const result = await handler({ query: "test", provider: "xai" });

      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.provider).toBe("xai");
      expect(parsed.results[0].title).toBe("xAI Result");
    });

    it("should fallback through providers on failure", async () => {
      process.env.GOOGLE_SEARCH_API_KEY = "test-key";
      process.env.GOOGLE_SEARCH_CX = "test-cx";
      process.env.BRAVE_SEARCH_API_KEY = "test-brave-key";

      mockFetch.mockReturnValueOnce(mockErrorResponse(500, "Server Error"));
      mockFetch.mockReturnValueOnce(
        mockOkResponse({
          web: {
            results: [
              { title: "Fallback Result", url: "https://brave.com/1", description: "From Brave" },
            ],
          },
        })
      );

      const config = buildWebSearchA2ATools({});
      const handler = config.tools[0].handler;
      const result = await handler({ query: "test" });

      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.provider).toBe("brave");
    });

    it("should filter out SSRF results from responses", async () => {
      process.env.BRAVE_SEARCH_API_KEY = "test-key";

      mockFetch.mockReturnValueOnce(
        mockOkResponse({
          web: {
            results: [
              { title: "Good", url: "https://example.com/1", description: "Public" },
              { title: "Bad", url: "http://127.0.0.1/secret", description: "Private" },
              { title: "Also Bad", url: "http://169.254.169.254/metadata", description: "Cloud metadata" },
            ],
          },
        })
      );

      const config = buildWebSearchA2ATools({});
      const handler = config.tools[0].handler;
      const result = await handler({ query: "test", provider: "brave" });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.resultCount).toBe(1);
      expect(parsed.results[0].title).toBe("Good");
    });

    it("should clamp count to max 20", async () => {
      process.env.BRAVE_SEARCH_API_KEY = "test-key";

      mockFetch.mockReturnValueOnce(mockOkResponse({ web: { results: [] } }));

      const config = buildWebSearchA2ATools({});
      const handler = config.tools[0].handler;
      await handler({ query: "test", count: 100, provider: "brave" });

      // Brave max is 20, so count param passed to URL should be 20
      const calledUrl = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl).toContain("count=20");
    });

    it("should respect custom provider order from config", async () => {
      process.env.BRAVE_SEARCH_API_KEY = "test-brave-key";
      process.env.XAI_API_KEY = "test-xai-key";

      mockFetch.mockReturnValueOnce(
        mockOkResponse({
          choices: [{ message: { content: "[]" } }],
          citations: [{ title: "xAI First", url: "https://xai.com" }],
        })
      );

      const config = buildWebSearchA2ATools({ providerOrder: ["xai", "brave"] });
      const handler = config.tools[0].handler;
      const result = await handler({ query: "test" });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.provider).toBe("xai");
    });

    it("should use provider config instead of env vars", async () => {
      mockFetch.mockReturnValueOnce(
        mockOkResponse({
          web: { results: [{ title: "Config Result", url: "https://example.com", description: "From config" }] },
        })
      );

      const config = buildWebSearchA2ATools({
        providers: { brave: { apiKey: "config-api-key" } },
      });
      const handler = config.tools[0].handler;
      const result = await handler({ query: "test", provider: "brave" });

      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.provider).toBe("brave");
    });
  });

  // ---------------------------------------------------------------------------
  // Individual providers
  // ---------------------------------------------------------------------------
  describe("GoogleSearchProvider", () => {
    it("should require cx in config", () => {
      expect(
        () => new GoogleSearchProvider({ apiKey: "key" })
      ).toThrow("requires 'cx'");
    });

    it("should construct with valid config", () => {
      const p = new GoogleSearchProvider({ apiKey: "key", extra: { cx: "cx-id" } });
      expect(p.name).toBe("google");
    });

    it("should make correct API call", async () => {
      mockFetch.mockReturnValueOnce(
        mockOkResponse({ items: [{ title: "T", link: "https://example.com", snippet: "S" }] })
      );

      const p = new GoogleSearchProvider({ apiKey: "my-key", extra: { cx: "my-cx" } });
      const results = await p.search("test", 5);

      expect(results).toHaveLength(1);
      expect(results[0].title).toBe("T");
      const calledUrl = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl).toContain("googleapis.com");
      expect(calledUrl).toContain("key=my-key");
      expect(calledUrl).toContain("cx=my-cx");
    });

    it("should cap results at 10 (Google CSE max)", async () => {
      mockFetch.mockReturnValueOnce(mockOkResponse({ items: [] }));

      const p = new GoogleSearchProvider({ apiKey: "key", extra: { cx: "cx" } });
      await p.search("test", 50);

      const calledUrl = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl).toContain("num=10");
    });

    it("should throw on API error", async () => {
      mockFetch.mockReturnValueOnce(mockErrorResponse(403, "Forbidden"));

      const p = new GoogleSearchProvider({ apiKey: "key", extra: { cx: "cx" } });
      await expect(p.search("test", 5)).rejects.toThrow("403");
    });

    it("should handle missing items in response", async () => {
      mockFetch.mockReturnValueOnce(mockOkResponse({}));

      const p = new GoogleSearchProvider({ apiKey: "key", extra: { cx: "cx" } });
      const results = await p.search("test", 5);
      expect(results).toEqual([]);
    });
  });

  describe("BraveSearchProvider", () => {
    it("should construct correctly", () => {
      const p = new BraveSearchProvider({ apiKey: "key" });
      expect(p.name).toBe("brave");
    });

    it("should make correct API call with auth header", async () => {
      mockFetch.mockReturnValueOnce(
        mockOkResponse({
          web: { results: [{ title: "B", url: "https://example.com", description: "D" }] },
        })
      );

      const p = new BraveSearchProvider({ apiKey: "brave-key" });
      const results = await p.search("test", 5);

      expect(results).toHaveLength(1);
      expect(results[0].snippet).toBe("D");
      const calledUrl = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl).toContain("api.search.brave.com");
      const callOpts = mockFetch.mock.calls[0][1] as any;
      expect(callOpts.headers["X-Subscription-Token"]).toBe("brave-key");
    });

    it("should cap results at 20 (Brave max)", async () => {
      mockFetch.mockReturnValueOnce(mockOkResponse({ web: { results: [] } }));

      const p = new BraveSearchProvider({ apiKey: "key" });
      await p.search("test", 50);

      const calledUrl = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl).toContain("count=20");
    });

    it("should handle empty results", async () => {
      mockFetch.mockReturnValueOnce(mockOkResponse({ web: {} }));

      const p = new BraveSearchProvider({ apiKey: "key" });
      const results = await p.search("test", 5);
      expect(results).toEqual([]);
    });

    it("should throw on API error", async () => {
      mockFetch.mockReturnValueOnce(mockErrorResponse(429, "Too Many Requests"));

      const p = new BraveSearchProvider({ apiKey: "key" });
      await expect(p.search("test", 5)).rejects.toThrow("429");
    });
  });

  describe("XaiSearchProvider", () => {
    it("should construct correctly", () => {
      const p = new XaiSearchProvider({ apiKey: "key" });
      expect(p.name).toBe("xai");
    });

    it("should prefer citations over parsed text", async () => {
      mockFetch.mockReturnValueOnce(
        mockOkResponse({
          citations: [
            { title: "Citation", url: "https://xai.com/c1" },
          ],
          choices: [{ message: { content: '[{"title":"Parsed","url":"https://xai.com/p1","snippet":"S"}]' } }],
        })
      );

      const p = new XaiSearchProvider({ apiKey: "key" });
      const results = await p.search("test", 5);

      expect(results[0].title).toBe("Citation");
      expect(results[0].url).toBe("https://xai.com/c1");
    });

    it("should fall back to parsing text response", async () => {
      mockFetch.mockReturnValueOnce(
        mockOkResponse({
          choices: [
            {
              message: {
                content: '```json\n[{"title":"Parsed","url":"https://xai.com/p1","snippet":"S"}]\n```',
              },
            },
          ],
        })
      );

      const p = new XaiSearchProvider({ apiKey: "key" });
      const results = await p.search("test", 5);

      expect(results).toHaveLength(1);
      expect(results[0].title).toBe("Parsed");
    });

    it("should return empty array on unparseable response", async () => {
      mockFetch.mockReturnValueOnce(
        mockOkResponse({
          choices: [{ message: { content: "No JSON here at all" } }],
        })
      );

      const p = new XaiSearchProvider({ apiKey: "key" });
      const results = await p.search("test", 5);
      expect(results).toEqual([]);
    });

    it("should send correct request body", async () => {
      mockFetch.mockReturnValueOnce(
        mockOkResponse({ choices: [{ message: { content: "[]" } }] })
      );

      const p = new XaiSearchProvider({ apiKey: "xai-key" });
      await p.search("test", 3);

      const callArgs = mockFetch.mock.calls[0];
      expect(callArgs[0]).toContain("x.ai");
      expect(callArgs[1].method).toBe("POST");
      expect(callArgs[1].headers.Authorization).toBe("Bearer xai-key");

      const body = JSON.parse(callArgs[1].body);
      expect(body.model).toBe("grok-3");
      expect(body.search_parameters.max_search_results).toBe(3);
    });

    it("should throw on API error", async () => {
      mockFetch.mockReturnValueOnce(mockErrorResponse(401, "Unauthorized"));

      const p = new XaiSearchProvider({ apiKey: "key" });
      await expect(p.search("test", 5)).rejects.toThrow("401");
    });

    it("should return empty array when no choices exist", async () => {
      mockFetch.mockReturnValueOnce(mockOkResponse({}));

      const p = new XaiSearchProvider({ apiKey: "key" });
      const results = await p.search("test", 5);
      expect(results).toEqual([]);
    });
  });
});
