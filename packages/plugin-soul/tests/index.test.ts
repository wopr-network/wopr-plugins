import { vi, describe, it, expect, beforeEach } from "vitest";

const mockSession = {
  getContext: vi.fn().mockResolvedValue(null),
  setContext: vi.fn().mockResolvedValue(undefined),
  readConversationLog: vi.fn().mockResolvedValue([]),
};

const mockCtx = {
  log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  registerContextProvider: vi.fn(),
  registerA2AServer: vi.fn(),
  unregisterContextProvider: vi.fn(),
  getSessions: vi.fn().mockReturnValue(["test-session"]),
  session: mockSession,
};

describe("wopr-plugin-soul", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockCtx.getSessions.mockReturnValue(["test-session"]);
    mockSession.getContext.mockResolvedValue(null);
    mockSession.setContext.mockResolvedValue(undefined);
  });

  describe("plugin init and shutdown", () => {
    it("should export a valid plugin with name, version, and description", async () => {
      const { default: plugin } = await import("../src/index.js");
      expect(plugin.name).toBe("wopr-plugin-soul");
      expect(plugin.version).toBe("1.0.0");
      expect(plugin.description).toContain("Soul");
    });

    it("should register context provider on init", async () => {
      const { default: plugin } = await import("../src/index.js");
      await plugin.init(mockCtx as any);
      expect(mockCtx.registerContextProvider).toHaveBeenCalledTimes(1);
    });

    it("should register A2A server on init", async () => {
      const { default: plugin } = await import("../src/index.js");
      await plugin.init(mockCtx as any);
      expect(mockCtx.registerA2AServer).toHaveBeenCalledTimes(1);
    });

    it("should use first available session name", async () => {
      mockCtx.getSessions.mockReturnValue(["my-session", "other"]);
      const { default: plugin } = await import("../src/index.js");
      await plugin.init(mockCtx as any);
      const serverConfig = mockCtx.registerA2AServer.mock.calls[0][0];
      expect(serverConfig.name).toBe("soul");
    });

    it("should fall back to 'default' session when no sessions exist", async () => {
      mockCtx.getSessions.mockReturnValue([]);
      const { default: plugin } = await import("../src/index.js");
      await plugin.init(mockCtx as any);
      expect(mockCtx.registerA2AServer).toHaveBeenCalledTimes(1);
    });

    it("should skip A2A registration when registerA2AServer is undefined", async () => {
      const ctxNoA2A = { ...mockCtx, registerA2AServer: undefined };
      const { default: plugin } = await import("../src/index.js");
      await plugin.init(ctxNoA2A as any);
      expect(mockCtx.registerContextProvider).toHaveBeenCalledTimes(1);
    });

    it("should log info on init", async () => {
      const { default: plugin } = await import("../src/index.js");
      await plugin.init(mockCtx as any);
      expect(mockCtx.log.info).toHaveBeenCalledWith("Soul plugin initialized");
    });

    it("should shutdown without errors", async () => {
      const { default: plugin } = await import("../src/index.js");
      await expect(plugin.shutdown()).resolves.toBeUndefined();
    });

    it("should have a manifest with required fields", async () => {
      const { default: plugin } = await import("../src/index.js");
      expect(plugin.manifest).toBeDefined();
      expect(plugin.manifest!.capabilities).toBeDefined();
      expect(plugin.manifest!.category).toBe("personality");
      expect(plugin.manifest!.tags).toContain("soul");
      expect(plugin.manifest!.icon).toBeTruthy();
      expect(plugin.manifest!.requires).toEqual({});
      expect(plugin.manifest!.provides).toBeDefined();
      expect(plugin.manifest!.lifecycle).toBeDefined();
    });

    it("should be idempotent on double shutdown", async () => {
      const { default: plugin } = await import("../src/index.js");
      await plugin.init(mockCtx as any);
      await plugin.shutdown();
      await expect(plugin.shutdown()).resolves.toBeUndefined();
    });

    it("should be re-initializable after shutdown", async () => {
      const { default: plugin } = await import("../src/index.js");
      await plugin.init(mockCtx as any);
      await plugin.shutdown();
      mockCtx.registerContextProvider.mockClear();
      mockCtx.registerA2AServer.mockClear();
      await plugin.init(mockCtx as any);
      expect(mockCtx.registerContextProvider).toHaveBeenCalledTimes(1);
      expect(mockCtx.registerA2AServer).toHaveBeenCalledTimes(1);
    });

    it("should export CONTEXT_PROVIDER_NAME", async () => {
      const { CONTEXT_PROVIDER_NAME } = await import("../src/index.js");
      expect(CONTEXT_PROVIDER_NAME).toBe("soul");
    });
  });

  describe("soul A2A tools", () => {
    it("should register two tools: soul.get and soul.update", async () => {
      const { default: plugin } = await import("../src/index.js");
      await plugin.init(mockCtx as any);
      const serverConfig = mockCtx.registerA2AServer.mock.calls[0][0];
      expect(serverConfig.tools).toHaveLength(2);
      expect(serverConfig.tools[0].name).toBe("soul.get");
      expect(serverConfig.tools[1].name).toBe("soul.update");
    });

    it("should have valid tool schemas", async () => {
      const { default: plugin } = await import("../src/index.js");
      await plugin.init(mockCtx as any);
      const serverConfig = mockCtx.registerA2AServer.mock.calls[0][0];

      for (const tool of serverConfig.tools) {
        expect(tool.name).toBeTruthy();
        expect(tool.description).toBeTruthy();
        expect(tool.inputSchema).toBeDefined();
        expect(tool.inputSchema.type).toBe("object");
        expect(typeof tool.handler).toBe("function");
      }
    });

    it("soul.update should have content, section, sectionContent properties", async () => {
      const { default: plugin } = await import("../src/index.js");
      await plugin.init(mockCtx as any);
      const serverConfig = mockCtx.registerA2AServer.mock.calls[0][0];
      const updateTool = serverConfig.tools[1];
      expect(updateTool.inputSchema.properties).toHaveProperty("content");
      expect(updateTool.inputSchema.properties).toHaveProperty("section");
      expect(updateTool.inputSchema.properties).toHaveProperty("sectionContent");
    });
  });

  describe("soul.get handler", () => {
    it("should return 'No SOUL.md found.' when no content in SQL", async () => {
      const { buildSoulA2ATools } = await import("../src/soul-a2a-tools.js");
      const config = buildSoulA2ATools(mockCtx as any, "test-session");
      const result = await config.tools[0].handler({});
      expect(result.content[0].text).toBe("No SOUL.md found.");
    });

    it("should return session SOUL.md content when session has it", async () => {
      mockSession.getContext.mockImplementation(async (session: string, _file: string) => {
        if (session === "test-session") return "Session persona";
        return null;
      });
      const { buildSoulA2ATools } = await import("../src/soul-a2a-tools.js");
      const config = buildSoulA2ATools(mockCtx as any, "test-session");
      const result = await config.tools[0].handler({});
      expect(result.content[0].text).toContain("[Source: session]");
      expect(result.content[0].text).toContain("Session persona");
    });

    it("should fall back to global SOUL.md when session has none", async () => {
      mockSession.getContext.mockImplementation(async (session: string, _file: string) => {
        if (session === "__global__") return "Global persona";
        return null;
      });
      const { buildSoulA2ATools } = await import("../src/soul-a2a-tools.js");
      const config = buildSoulA2ATools(mockCtx as any, "test-session");
      const result = await config.tools[0].handler({});
      expect(result.content[0].text).toContain("[Source: global]");
      expect(result.content[0].text).toContain("Global persona");
    });
  });

  describe("soul.update handler", () => {
    it("should replace entire SOUL.md via setContext when content is provided", async () => {
      const { buildSoulA2ATools } = await import("../src/soul-a2a-tools.js");
      const config = buildSoulA2ATools(mockCtx as any, "test-session");
      const updateTool = config.tools[1];

      const result = await updateTool.handler({ content: "New soul content" });
      expect(mockSession.setContext).toHaveBeenCalledWith(
        "test-session",
        "SOUL.md",
        "New soul content",
        "session",
      );
      expect(result.content[0].text).toBe("SOUL.md replaced entirely");
    });

    it("should add section when no existing SOUL.md in SQL", async () => {
      const { buildSoulA2ATools } = await import("../src/soul-a2a-tools.js");
      const config = buildSoulA2ATools(mockCtx as any, "test-session");
      const updateTool = config.tools[1];

      const result = await updateTool.handler({
        section: "Boundaries",
        sectionContent: "Be kind",
      });
      expect(mockSession.setContext).toHaveBeenCalled();
      const written = mockSession.setContext.mock.calls[0][2] as string;
      expect(written).toContain("## Boundaries");
      expect(written).toContain("Be kind");
      expect(result.content[0].text).toContain("Boundaries");
    });

    it("should update existing section in SOUL.md", async () => {
      mockSession.getContext.mockResolvedValue(
        "# SOUL.md\n\n## Boundaries\n\nOld content\n",
      );
      const { buildSoulA2ATools } = await import("../src/soul-a2a-tools.js");
      const config = buildSoulA2ATools(mockCtx as any, "test-session");
      const updateTool = config.tools[1];

      const result = await updateTool.handler({
        section: "Boundaries",
        sectionContent: "New boundary content",
      });
      const written = mockSession.setContext.mock.calls[0][2] as string;
      expect(written).toContain("New boundary content");
      expect(written).not.toContain("Old content");
      expect(result.content[0].text).toContain('section "Boundaries" updated');
    });

    it("should return error when neither content nor section provided", async () => {
      const { buildSoulA2ATools } = await import("../src/soul-a2a-tools.js");
      const config = buildSoulA2ATools(mockCtx as any, "test-session");
      const updateTool = config.tools[1];

      const result = await updateTool.handler({});
      expect(result.content[0].text).toContain("Provide");
      expect(result).not.toHaveProperty("isError");
    });

    it("should handle section names with regex-special characters", async () => {
      mockSession.getContext.mockResolvedValue(
        "# SOUL.md\n\n## Goals (v2)\n\nOld goals\n",
      );
      const { buildSoulA2ATools } = await import("../src/soul-a2a-tools.js");
      const config = buildSoulA2ATools(mockCtx as any, "test-session");
      const updateTool = config.tools[1];

      const result = await updateTool.handler({
        section: "Goals (v2)",
        sectionContent: "New goals",
      });
      const written = mockSession.setContext.mock.calls[0][2] as string;
      expect(written).toContain("New goals");
      expect(written).not.toContain("Old goals");
      expect(result.content[0].text).toContain('section "Goals (v2)" updated');
    });

    it("should append new section when section name has brackets", async () => {
      mockSession.getContext.mockResolvedValue("# SOUL.md\n\n## Existing\n\nStuff\n");
      const { buildSoulA2ATools } = await import("../src/soul-a2a-tools.js");
      const config = buildSoulA2ATools(mockCtx as any, "test-session");
      const updateTool = config.tools[1];

      const result = await updateTool.handler({
        section: "Rules [strict]",
        sectionContent: "Be precise",
      });
      const written = mockSession.setContext.mock.calls[0][2] as string;
      expect(written).toContain("## Rules [strict]");
      expect(written).toContain("Be precise");
      expect(written).toContain("## Existing");
    });
  });

  describe("soul A2A tools - session guard and error handling", () => {
    it("soul.get should return 'No SOUL.md found.' when ctx has no session", async () => {
      const ctxNoSession = { ...mockCtx, session: undefined };
      const { buildSoulA2ATools } = await import("../src/soul-a2a-tools.js");
      const config = buildSoulA2ATools(ctxNoSession as any, "test-session");
      const result = await config.tools[0].handler({});
      expect(result.content[0].text).toBe("No SOUL.md found.");
    });

    it("soul.get should return 'No SOUL.md found.' when getContext throws", async () => {
      mockSession.getContext.mockRejectedValue(new Error("DB error"));
      const { buildSoulA2ATools } = await import("../src/soul-a2a-tools.js");
      const config = buildSoulA2ATools(mockCtx as any, "test-session");
      const result = await config.tools[0].handler({});
      expect(result.content[0].text).toBe("No SOUL.md found.");
    });

    it("soul.update should return prompt message when ctx has no session", async () => {
      const ctxNoSession = { ...mockCtx, session: undefined };
      const { buildSoulA2ATools } = await import("../src/soul-a2a-tools.js");
      const config = buildSoulA2ATools(ctxNoSession as any, "test-session");
      const result = await config.tools[1].handler({ content: "New content" });
      expect(result.content[0].text).toContain("Provide");
    });

    it("soul.update should return error when setContext throws", async () => {
      mockSession.setContext.mockRejectedValue(new Error("DB error"));
      const { buildSoulA2ATools } = await import("../src/soul-a2a-tools.js");
      const config = buildSoulA2ATools(mockCtx as any, "test-session");
      const result = await config.tools[1].handler({ content: "New content" });
      expect(result.content[0].text).toBe("Failed to update SOUL.md: DB error");
    });
  });

  describe("soul context provider - session guard and error handling", () => {
    it("should return null when ctx has no session", async () => {
      const ctxNoSession = { ...mockCtx, session: undefined };
      const { buildSoulContextProvider } = await import("../src/soul-context-provider.js");
      const provider = buildSoulContextProvider(ctxNoSession as any);
      const result = await provider.getContext("test-session", {} as any);
      expect(result).toBeNull();
    });

    it("should return null when getContext throws", async () => {
      mockSession.getContext.mockRejectedValue(new Error("DB error"));
      const { buildSoulContextProvider } = await import("../src/soul-context-provider.js");
      const provider = buildSoulContextProvider(mockCtx as any);
      const result = await provider.getContext("test-session", {} as any);
      expect(result).toBeNull();
    });
  });

  describe("soul context provider", () => {
    it("should have correct name, priority, and enabled flag", async () => {
      const { buildSoulContextProvider } = await import("../src/soul-context-provider.js");
      const provider = buildSoulContextProvider(mockCtx as any);
      expect(provider.name).toBe("soul");
      expect(provider.priority).toBe(8);
      expect(provider.enabled).toBe(true);
    });

    it("should return global soul content when global entry exists", async () => {
      mockSession.getContext.mockImplementation(async (session: string, _file: string) => {
        if (session === "__global__") return "Global persona";
        return null;
      });
      const { buildSoulContextProvider } = await import("../src/soul-context-provider.js");
      const provider = buildSoulContextProvider(mockCtx as any);

      const result = await provider.getContext("test-session", {} as any);
      expect(result).not.toBeNull();
      expect(result!.content).toContain("Soul (Global)");
      expect(result!.content).toContain("Global persona");
      expect(result!.role).toBe("system");
      expect(result!.metadata.source).toBe("soul");
      expect(result!.metadata.location).toBe("global");
    });

    it("should fall back to session soul content", async () => {
      mockSession.getContext.mockImplementation(async (session: string, _file: string) => {
        if (session === "test-session") return "Session persona";
        return null;
      });
      const { buildSoulContextProvider } = await import("../src/soul-context-provider.js");
      const provider = buildSoulContextProvider(mockCtx as any);

      const result = await provider.getContext("test-session", {} as any);
      expect(result).not.toBeNull();
      expect(result!.content).toContain("Soul");
      expect(result!.content).toContain("Session persona");
      expect(result!.metadata.location).toBe("session");
    });

    it("should return null when no SOUL.md exists anywhere", async () => {
      const { buildSoulContextProvider } = await import("../src/soul-context-provider.js");
      const provider = buildSoulContextProvider(mockCtx as any);

      const result = await provider.getContext("test-session", {} as any);
      expect(result).toBeNull();
    });

    it("should return null when SOUL.md content is empty/whitespace", async () => {
      mockSession.getContext.mockResolvedValue("   \n  ");
      const { buildSoulContextProvider } = await import("../src/soul-context-provider.js");
      const provider = buildSoulContextProvider(mockCtx as any);

      const result = await provider.getContext("test-session", {} as any);
      expect(result).toBeNull();
    });
  });
});
