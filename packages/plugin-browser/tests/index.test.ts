import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mock Playwright before any imports
// ---------------------------------------------------------------------------
const mockPage = {
  goto: vi.fn().mockResolvedValue(undefined),
  url: vi.fn().mockReturnValue("https://example.com/page"),
  title: vi.fn().mockResolvedValue("Example Page"),
  content: vi.fn().mockResolvedValue("<html><body><h1>Hello</h1><p>World</p></body></html>"),
  click: vi.fn().mockResolvedValue(undefined),
  fill: vi.fn().mockResolvedValue(undefined),
  press: vi.fn().mockResolvedValue(undefined),
  screenshot: vi.fn().mockResolvedValue(Buffer.from("fake-png-data")),
  $: vi.fn().mockResolvedValue({
    screenshot: vi.fn().mockResolvedValue(Buffer.from("element-png-data")),
  }),
  evaluate: vi.fn().mockResolvedValue({ result: "value" }),
};

const mockContext = {
  addCookies: vi.fn().mockResolvedValue(undefined),
  cookies: vi.fn().mockResolvedValue([]),
  newPage: vi.fn().mockResolvedValue(mockPage),
};

const mockBrowser = {
  isConnected: vi.fn().mockReturnValue(true),
  newContext: vi.fn().mockResolvedValue(mockContext),
  close: vi.fn().mockResolvedValue(undefined),
  process: vi.fn().mockReturnValue(null),
};

vi.mock("playwright", () => ({
  chromium: {
    launch: vi.fn().mockResolvedValue(mockBrowser),
  },
}));

// Mock node:fs (writeFileSync for screenshots)
vi.mock("node:fs", () => ({
  writeFileSync: vi.fn(),
}));

// Mock node:crypto (randomUUID)
vi.mock("node:crypto", () => ({
  randomUUID: vi.fn().mockReturnValue("mock-uuid-1234"),
}));

// ---------------------------------------------------------------------------
// Mock storage for browser-profile
// ---------------------------------------------------------------------------
const mockRepo = {
  findFirst: vi.fn().mockResolvedValue(null),
  findMany: vi.fn().mockResolvedValue([]),
  insert: vi.fn().mockImplementation((row: any) => Promise.resolve(row)),
  insertMany: vi.fn().mockResolvedValue(undefined),
  deleteMany: vi.fn().mockResolvedValue(undefined),
  update: vi.fn().mockResolvedValue(undefined),
};

const mockStorage = {
  register: vi.fn().mockResolvedValue(undefined),
  isRegistered: vi.fn().mockReturnValue(false),
  getRepository: vi.fn().mockReturnValue(mockRepo),
  transaction: vi.fn().mockImplementation(async (fn: any) => {
    const txStorage = {
      getRepository: vi.fn().mockReturnValue(mockRepo),
    };
    await fn(txStorage);
  }),
};

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------
import plugin from "../src/index.js";
import { isUrlSafe, buildBrowserA2ATools, closeAllBrowsers } from "../src/browser.js";
import { initBrowserProfileStorage, loadProfile, saveProfile, listProfiles } from "../src/browser-profile.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function mockCtx(overrides: Record<string, any> = {}) {
  return {
    storage: mockStorage,
    registerA2AServer: vi.fn(),
    registerExtension: vi.fn(),
    log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
    getConfig: vi.fn().mockReturnValue({}),
    ...overrides,
  };
}

const mockLog = { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() };

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("wopr-plugin-browser", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ---------------------------------------------------------------------------
  // Plugin lifecycle
  // ---------------------------------------------------------------------------
  describe("plugin lifecycle", () => {
    it("should have correct metadata", () => {
      expect(plugin.name).toBe("wopr-plugin-browser");
      expect(plugin.version).toBe("1.0.0");
    });

    it("should have complete manifest fields", () => {
      expect(plugin.name).toBe("wopr-plugin-browser");
      expect(plugin.version).toBe("1.0.0");
      expect(plugin.description).toBeTruthy();
      const manifest = plugin.manifest!;
      expect(manifest.category).toBe("utility");
      expect(manifest.tags).toEqual(["browser", "automation", "playwright", "scraping"]);
      expect(manifest.icon).toBe("globe");
      expect(manifest.capabilities).toEqual(["browser-automation"]);
    });

    it("should declare configSchema", () => {
      const schema = plugin.manifest?.configSchema;
      expect(schema).toBeDefined();
      expect(schema!.fields).toBeDefined();
      const headless = schema!.fields.find((f) => f.name === "headless");
      const timeout = schema!.fields.find((f) => f.name === "defaultTimeout");
      expect(headless).toBeDefined();
      expect(headless!.type).toBe("boolean");
      expect(headless!.default).toBe(true);
      expect(timeout).toBeDefined();
      expect(timeout!.type).toBe("number");
      expect(timeout!.default).toBe(30000);
    });

    it("should be safe to call shutdown() twice", async () => {
      const ctx = mockCtx();
      await plugin.init(ctx as any);
      await plugin.shutdown();
      await plugin.shutdown(); // second call must not throw
    });

    it("shutdown should clear storage reference", async () => {
      const ctx = mockCtx();
      await plugin.init(ctx as any);
      await plugin.shutdown();
      // After shutdown, calling loadProfile should throw "not initialized"
      await expect(loadProfile("anything")).rejects.toThrow("not initialized");
    });

    it("should init and register A2A server", async () => {
      const ctx = mockCtx();
      await plugin.init(ctx as any);
      expect(mockStorage.register).toHaveBeenCalled();
      expect(ctx.registerA2AServer).toHaveBeenCalledTimes(1);
      const serverConfig = ctx.registerA2AServer.mock.calls[0][0];
      expect(serverConfig.name).toBe("browser");
      expect(serverConfig.tools.length).toBe(5);
    });

    it("should register 5 browser tools", async () => {
      const ctx = mockCtx();
      await plugin.init(ctx as any);
      const tools = ctx.registerA2AServer.mock.calls[0][0].tools;
      const toolNames = tools.map((t: any) => t.name);
      expect(toolNames).toContain("browser_navigate");
      expect(toolNames).toContain("browser_click");
      expect(toolNames).toContain("browser_type");
      expect(toolNames).toContain("browser_screenshot");
      expect(toolNames).toContain("browser_evaluate");
    });

    it("should log headless mode", async () => {
      const ctx = mockCtx();
      await plugin.init(ctx as any);
      expect(ctx.log.info).toHaveBeenCalledWith(
        expect.stringContaining("Browser plugin initialized"),
        true
      );
    });

    it("should skip registerA2AServer if not available", async () => {
      const ctx = mockCtx({ registerA2AServer: undefined });
      await plugin.init(ctx as any);
      // No error
    });

    it("should use headless config from getConfig", async () => {
      const ctx = mockCtx();
      ctx.getConfig.mockReturnValue({ headless: false });
      await plugin.init(ctx as any);
      expect(ctx.log.info).toHaveBeenCalledWith(
        expect.stringContaining("Browser plugin initialized"),
        false
      );
    });
  });

  // ---------------------------------------------------------------------------
  // SSRF protection — isUrlSafe
  // ---------------------------------------------------------------------------
  describe("isUrlSafe", () => {
    it("should allow public HTTPS URLs", () => {
      expect(isUrlSafe("https://www.google.com")).toEqual({ safe: true });
      expect(isUrlSafe("https://example.com/path")).toEqual({ safe: true });
    });

    it("should allow public HTTP URLs", () => {
      expect(isUrlSafe("http://example.com")).toEqual({ safe: true });
    });

    it("should block invalid URLs", () => {
      const result = isUrlSafe("not-a-url");
      expect(result.safe).toBe(false);
      expect(result.reason).toBe("Invalid URL");
    });

    it("should block non-http schemes", () => {
      const result = isUrlSafe("ftp://example.com/file");
      expect(result.safe).toBe(false);
      expect(result.reason).toContain("Blocked URL scheme");
    });

    it("should block file:// scheme", () => {
      const result = isUrlSafe("file:///etc/passwd");
      expect(result.safe).toBe(false);
    });

    it("should block localhost", () => {
      const result = isUrlSafe("http://localhost/admin");
      expect(result.safe).toBe(false);
      expect(result.reason).toContain("private");
    });

    it("should block localhost with trailing dot", () => {
      const result = isUrlSafe("http://localhost./admin");
      expect(result.safe).toBe(false);
    });

    it("should block 127.0.0.1", () => {
      const result = isUrlSafe("http://127.0.0.1:8080/");
      expect(result.safe).toBe(false);
    });

    it("should block 10.x.x.x private range", () => {
      expect(isUrlSafe("http://10.0.0.1/").safe).toBe(false);
      expect(isUrlSafe("http://10.255.255.255/").safe).toBe(false);
    });

    it("should block 172.16-31.x.x private range", () => {
      expect(isUrlSafe("http://172.16.0.1/").safe).toBe(false);
      expect(isUrlSafe("http://172.31.255.1/").safe).toBe(false);
    });

    it("should block 192.168.x.x private range", () => {
      expect(isUrlSafe("http://192.168.1.1/").safe).toBe(false);
    });

    it("should block link-local 169.254.x.x", () => {
      expect(isUrlSafe("http://169.254.169.254/").safe).toBe(false);
    });

    it("should block IPv6 loopback", () => {
      expect(isUrlSafe("http://[::1]/").safe).toBe(false);
    });

    it("should block 0.0.0.0", () => {
      expect(isUrlSafe("http://0.0.0.0/").safe).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // buildBrowserA2ATools
  // ---------------------------------------------------------------------------
  describe("buildBrowserA2ATools", () => {
    it("should return correct server config", () => {
      const config = buildBrowserA2ATools(mockLog as any, true);
      expect(config.name).toBe("browser");
      expect(config.version).toBe("1.0.0");
      expect(config.tools).toHaveLength(5);
    });

    it("should define correct input schemas for navigate", () => {
      const config = buildBrowserA2ATools(mockLog as any, true);
      const nav = config.tools.find((t) => t.name === "browser_navigate")!;
      expect(nav.inputSchema.required).toContain("url");
      expect(nav.inputSchema.properties).toHaveProperty("url");
      expect(nav.inputSchema.properties).toHaveProperty("profile");
      expect(nav.inputSchema.properties).toHaveProperty("waitFor");
      expect(nav.inputSchema.properties).toHaveProperty("timeout");
    });

    it("should define correct input schemas for click", () => {
      const config = buildBrowserA2ATools(mockLog as any, true);
      const click = config.tools.find((t) => t.name === "browser_click")!;
      expect(click.inputSchema.required).toContain("selector");
    });

    it("should define correct input schemas for type", () => {
      const config = buildBrowserA2ATools(mockLog as any, true);
      const type = config.tools.find((t) => t.name === "browser_type")!;
      expect(type.inputSchema.required).toContain("selector");
      expect(type.inputSchema.required).toContain("text");
    });

    it("should define correct input schemas for evaluate", () => {
      const config = buildBrowserA2ATools(mockLog as any, true);
      const evaluate = config.tools.find((t) => t.name === "browser_evaluate")!;
      expect(evaluate.inputSchema.required).toContain("expression");
    });
  });

  // ---------------------------------------------------------------------------
  // browser_navigate handler
  // ---------------------------------------------------------------------------
  describe("browser_navigate handler", () => {
    it("should block private URLs", async () => {
      const config = buildBrowserA2ATools(mockLog as any, true);
      const nav = config.tools.find((t) => t.name === "browser_navigate")!;
      const result = await nav.handler({ url: "http://localhost/admin" });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Navigation blocked");
    });

    it("should block non-http schemes", async () => {
      const config = buildBrowserA2ATools(mockLog as any, true);
      const nav = config.tools.find((t) => t.name === "browser_navigate")!;
      const result = await nav.handler({ url: "file:///etc/passwd" });
      expect(result.isError).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // browser_evaluate handler — blocked patterns
  // ---------------------------------------------------------------------------
  describe("browser_evaluate handler", () => {
    it("should block require() calls", async () => {
      const config = buildBrowserA2ATools(mockLog as any, true);
      const evalTool = config.tools.find((t) => t.name === "browser_evaluate")!;
      const result = await evalTool.handler({ expression: "require('fs')" });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Blocked");
    });

    it("should block process. access", async () => {
      const config = buildBrowserA2ATools(mockLog as any, true);
      const evalTool = config.tools.find((t) => t.name === "browser_evaluate")!;
      const result = await evalTool.handler({ expression: "process.env.SECRET" });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Blocked");
    });

    it("should block child_process", async () => {
      const config = buildBrowserA2ATools(mockLog as any, true);
      const evalTool = config.tools.find((t) => t.name === "browser_evaluate")!;
      const result = await evalTool.handler({ expression: "child_process.exec('ls')" });
      expect(result.isError).toBe(true);
    });

    it("should block eval()", async () => {
      const config = buildBrowserA2ATools(mockLog as any, true);
      const evalTool = config.tools.find((t) => t.name === "browser_evaluate")!;
      const result = await evalTool.handler({ expression: "eval('alert(1)')" });
      expect(result.isError).toBe(true);
    });

    it("should block import()", async () => {
      const config = buildBrowserA2ATools(mockLog as any, true);
      const evalTool = config.tools.find((t) => t.name === "browser_evaluate")!;
      const result = await evalTool.handler({ expression: "import('fs')" });
      expect(result.isError).toBe(true);
    });

    it("should block fetch()", async () => {
      const config = buildBrowserA2ATools(mockLog as any, true);
      const evalTool = config.tools.find((t) => t.name === "browser_evaluate")!;
      const result = await evalTool.handler({ expression: "fetch('http://evil.com')" });
      expect(result.isError).toBe(true);
    });

    it("should block __dirname", async () => {
      const config = buildBrowserA2ATools(mockLog as any, true);
      const evalTool = config.tools.find((t) => t.name === "browser_evaluate")!;
      const result = await evalTool.handler({ expression: "__dirname" });
      expect(result.isError).toBe(true);
    });

    it("should allow safe expressions", async () => {
      const config = buildBrowserA2ATools(mockLog as any, true);
      const evalTool = config.tools.find((t) => t.name === "browser_evaluate")!;
      const result = await evalTool.handler({ expression: "document.title" });
      // This would try to create a browser instance; it may fail since our mock
      // is limited, but it should NOT be blocked by pattern check
      expect(result.content[0].text).not.toContain("Blocked");
    });
  });

  // ---------------------------------------------------------------------------
  // Browser profile storage
  // ---------------------------------------------------------------------------
  describe("browser-profile", () => {
    beforeEach(async () => {
      mockStorage.isRegistered.mockReturnValue(false);
      mockRepo.findFirst.mockResolvedValue(null);
      mockRepo.findMany.mockResolvedValue([]);
      mockRepo.insert.mockImplementation((row: any) => Promise.resolve(row));
      await initBrowserProfileStorage(mockStorage as any);
    });

    it("should register schema on init if not registered", async () => {
      mockStorage.isRegistered.mockReturnValue(false);
      await initBrowserProfileStorage(mockStorage as any);
      expect(mockStorage.register).toHaveBeenCalled();
    });

    it("should skip registration if already registered", async () => {
      mockStorage.isRegistered.mockReturnValue(true);
      mockStorage.register.mockClear();
      await initBrowserProfileStorage(mockStorage as any);
      expect(mockStorage.register).not.toHaveBeenCalled();
    });

    it("should load a new profile (creates if missing)", async () => {
      mockRepo.findFirst.mockResolvedValue(null);
      mockRepo.insert.mockImplementation((row: any) => Promise.resolve(row));

      const profile = await loadProfile("test-profile");
      expect(profile.name).toBe("test-profile");
      expect(profile.cookies).toEqual([]);
      expect(profile.localStorage).toEqual({});
    });

    it("should load an existing profile with cookies", async () => {
      mockRepo.findFirst.mockResolvedValue({
        id: "profile-1",
        name: "existing",
        createdAt: 1000,
        updatedAt: 2000,
      });
      mockRepo.findMany
        .mockResolvedValueOnce([
          {
            id: "c1",
            profileId: "profile-1",
            name: "session",
            value: "abc",
            domain: ".example.com",
            path: "/",
            httpOnly: 1,
            secure: 0,
          },
        ])
        .mockResolvedValueOnce([]);

      const profile = await loadProfile("existing");
      expect(profile.cookies).toHaveLength(1);
      expect(profile.cookies[0].name).toBe("session");
      expect(profile.cookies[0].httpOnly).toBe(true);
      expect(profile.cookies[0].secure).toBe(false);
    });

    it("should save a profile with cookies", async () => {
      mockRepo.findFirst.mockResolvedValue({
        id: "profile-1",
        name: "test",
        createdAt: 1000,
        updatedAt: 2000,
      });

      await saveProfile({
        name: "test",
        cookies: [
          { name: "token", value: "xyz", domain: ".example.com", path: "/" },
        ],
        localStorage: {},
        updatedAt: 3000,
      });

      expect(mockRepo.deleteMany).toHaveBeenCalled();
      expect(mockRepo.insertMany).toHaveBeenCalled();
    });

    it("should save a profile with localStorage data", async () => {
      mockRepo.findFirst.mockResolvedValue({
        id: "profile-1",
        name: "test",
        createdAt: 1000,
        updatedAt: 2000,
      });

      await saveProfile({
        name: "test",
        cookies: [],
        localStorage: {
          "https://example.com": { theme: "dark", lang: "en" },
        },
        updatedAt: 3000,
      });

      // localStorage insertMany should be called with 2 rows
      const lsInsertCall = mockRepo.insertMany.mock.calls.find((call: any) =>
        call[0]?.some?.((row: any) => row.origin === "https://example.com")
      );
      expect(lsInsertCall).toBeDefined();
      expect(lsInsertCall[0]).toHaveLength(2);
    });

    it("should list profiles", async () => {
      mockRepo.findMany.mockResolvedValueOnce([
        { id: "1", name: "default" },
        { id: "2", name: "work" },
      ]);

      const profiles = await listProfiles();
      expect(profiles).toEqual(["default", "work"]);
    });
  });

  // ---------------------------------------------------------------------------
  // Browser profile schema
  // ---------------------------------------------------------------------------
  describe("browser-profile-schema", () => {
    it("should export valid plugin schema", async () => {
      const { browserProfilePluginSchema } = await import("../src/browser-profile-schema.js");
      expect(browserProfilePluginSchema.namespace).toBe("browser");
      expect(browserProfilePluginSchema.version).toBe(1);
      expect(browserProfilePluginSchema.tables).toHaveProperty("profiles");
      expect(browserProfilePluginSchema.tables).toHaveProperty("cookies");
      expect(browserProfilePluginSchema.tables).toHaveProperty("localStorage");
    });

    it("should have correct primary keys", async () => {
      const { browserProfilePluginSchema } = await import("../src/browser-profile-schema.js");
      expect(browserProfilePluginSchema.tables.profiles.primaryKey).toBe("id");
      expect(browserProfilePluginSchema.tables.cookies.primaryKey).toBe("id");
      expect(browserProfilePluginSchema.tables.localStorage.primaryKey).toBe("id");
    });

    it("should have unique index on profile name", async () => {
      const { browserProfilePluginSchema } = await import("../src/browser-profile-schema.js");
      const profileIndexes = browserProfilePluginSchema.tables.profiles.indexes;
      expect(profileIndexes).toContainEqual({ fields: ["name"], unique: true });
    });
  });
});
