import { vi, describe, it, expect, beforeEach } from "vitest";

// Mock all module dependencies before importing plugin
vi.mock("../src/a2a-tools.js", () => ({
  registerSkillsA2ATools: vi.fn(),
  unregisterSkillsA2ATools: vi.fn(),
  setA2AContext: vi.fn(),
}));

vi.mock("../src/logger.js", () => ({
  setLogger: vi.fn(),
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("../src/skills.js", () => ({
  discoverSkills: vi.fn(() => ({ skills: [], warnings: [] })),
  formatSkillsXml: vi.fn(() => ""),
  installSkillFromGitHub: vi.fn(),
  installSkillFromUrl: vi.fn(),
  enableSkillAsync: vi.fn(),
  disableSkillAsync: vi.fn(),
}));

vi.mock("../src/skills-migrate.js", () => ({
  migrateSkillsToSQL: vi.fn(),
  migrateRegistriesToSQL: vi.fn(),
}));

vi.mock("../src/skills-repository.js", () => ({
  initSkillsStorage: vi.fn(),
  resetSkillsStorageInit: vi.fn(),
  setPluginContext: vi.fn(),
}));

vi.mock("../src/skills-schema.js", () => ({
  skillsPluginSchema: {
    namespace: "skills",
    version: 1,
    tables: {},
  },
}));

vi.mock("../src/routes.js", () => ({
  createSkillsRouter: vi.fn(() => ({ fake: "router" })),
}));

import plugin from "../src/index.js";
import { registerSkillsA2ATools, unregisterSkillsA2ATools, setA2AContext } from "../src/a2a-tools.js";
import { setLogger } from "../src/logger.js";
import { initSkillsStorage, resetSkillsStorageInit, setPluginContext } from "../src/skills-repository.js";
import { migrateSkillsToSQL } from "../src/skills-migrate.js";
import { createSkillsRouter } from "../src/routes.js";
import { discoverSkills, formatSkillsXml, installSkillFromGitHub, installSkillFromUrl, enableSkillAsync, disableSkillAsync } from "../src/skills.js";

function createMockCtx() {
  return {
    storage: {
      register: vi.fn(),
      get: vi.fn(),
      set: vi.fn(),
      getRepository: vi.fn(),
    },
    registerExtension: vi.fn(),
    unregisterExtension: vi.fn(),
    registerContextProvider: vi.fn(),
    unregisterContextProvider: vi.fn(),
    registerA2AServer: vi.fn(),
    log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
    logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  } as any;
}

describe("wopr-plugin-skills", () => {
  let mockCtx: ReturnType<typeof createMockCtx>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockCtx = createMockCtx();
  });

  describe("plugin metadata", () => {
    it("has correct name", () => {
      expect(plugin.name).toBe("wopr-plugin-skills");
    });

    it("has correct version", () => {
      expect(plugin.version).toBe("1.0.0");
    });

    it("has a description", () => {
      expect(plugin.description).toBeDefined();
      expect(plugin.description.length).toBeGreaterThan(0);
    });
  });

  describe("init()", () => {
    it("sets logger from context", async () => {
      await plugin.init(mockCtx);
      expect(setLogger).toHaveBeenCalledWith(mockCtx.log);
    });

    it("sets plugin context on repository", async () => {
      await plugin.init(mockCtx);
      expect(setPluginContext).toHaveBeenCalledWith(mockCtx);
    });

    it("sets A2A context", async () => {
      await plugin.init(mockCtx);
      expect(setA2AContext).toHaveBeenCalledWith(mockCtx);
    });

    it("registers storage schema", async () => {
      await plugin.init(mockCtx);
      expect(mockCtx.storage.register).toHaveBeenCalled();
    });

    it("initializes skills storage", async () => {
      await plugin.init(mockCtx);
      expect(initSkillsStorage).toHaveBeenCalled();
    });

    it("runs migration", async () => {
      await plugin.init(mockCtx);
      expect(migrateSkillsToSQL).toHaveBeenCalledWith(mockCtx);
    });

    it("registers context provider for skills", async () => {
      await plugin.init(mockCtx);
      expect(mockCtx.registerContextProvider).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "skills",
          priority: 10,
          enabled: true,
        }),
      );
    });

    it("registers context provider with getContext function", async () => {
      await plugin.init(mockCtx);
      const call = mockCtx.registerContextProvider.mock.calls[0][0];
      expect(typeof call.getContext).toBe("function");
    });

    it("registers A2A tools", async () => {
      await plugin.init(mockCtx);
      expect(registerSkillsA2ATools).toHaveBeenCalled();
    });

    it("registers skills router as extension", async () => {
      await plugin.init(mockCtx);
      expect(createSkillsRouter).toHaveBeenCalled();
      expect(mockCtx.registerExtension).toHaveBeenCalledWith("skills:router", { fake: "router" });
    });

    it("registers skills extension API", async () => {
      await plugin.init(mockCtx);
      expect(mockCtx.registerExtension).toHaveBeenCalledWith("skills", {
        install: installSkillFromGitHub,
        installFromUrl: installSkillFromUrl,
        enable: enableSkillAsync,
        disable: disableSkillAsync,
        list: discoverSkills,
      });
    });

    it("logs initialization message", async () => {
      await plugin.init(mockCtx);
      expect(mockCtx.log.info).toHaveBeenCalledWith("Skills plugin initialized");
    });
  });

  describe("shutdown()", () => {
    it("unregisters context provider after init", async () => {
      await plugin.init(mockCtx);
      await plugin.shutdown();
      expect(mockCtx.unregisterContextProvider).toHaveBeenCalledWith("skills");
    });

    it("unregisters extension after init", async () => {
      await plugin.init(mockCtx);
      await plugin.shutdown();
      expect(mockCtx.unregisterExtension).toHaveBeenCalledWith("skills:router");
    });

    it("unregisters skills extension after init", async () => {
      await plugin.init(mockCtx);
      await plugin.shutdown();
      expect(mockCtx.unregisterExtension).toHaveBeenCalledWith("skills");
    });

    it("unregisters A2A tools after init", async () => {
      await plugin.init(mockCtx);
      await plugin.shutdown();
      expect(unregisterSkillsA2ATools).toHaveBeenCalled();
    });

    it("resets storage init after init", async () => {
      await plugin.init(mockCtx);
      await plugin.shutdown();
      expect(resetSkillsStorageInit).toHaveBeenCalled();
    });

    it("does not throw when called without init", async () => {
      await plugin.shutdown();
      // Should not throw
    });
  });

  describe("context provider getContext", () => {
    it("returns null when no skills discovered", async () => {
      vi.mocked(discoverSkills).mockReturnValue({ skills: [], warnings: [] });

      await plugin.init(mockCtx);
      const provider = mockCtx.registerContextProvider.mock.calls[0][0];
      const result = await provider.getContext();
      expect(result).toBeNull();
    });

    it("returns formatted skills XML when skills exist", async () => {
      const mockSkills = [
        { name: "test-skill", description: "A test skill", path: "/test", baseDir: "/test", source: "managed" },
      ] as any[];
      vi.mocked(discoverSkills).mockReturnValue({ skills: mockSkills, warnings: [] });
      vi.mocked(formatSkillsXml).mockReturnValue("<skills>test</skills>");

      await plugin.init(mockCtx);
      const provider = mockCtx.registerContextProvider.mock.calls[0][0];
      const result = await provider.getContext();

      expect(result).toEqual({
        content: "<skills>test</skills>",
        role: "system",
        metadata: { source: "skills", priority: 10, skillCount: 1 },
      });
    });

    it("logs warnings from skill discovery", async () => {
      vi.mocked(discoverSkills).mockReturnValue({
        skills: [],
        warnings: [{ skillPath: "/bad/skill", message: "invalid frontmatter" }],
      });

      await plugin.init(mockCtx);
      const provider = mockCtx.registerContextProvider.mock.calls[0][0];
      await provider.getContext();

      expect(mockCtx.log.warn).toHaveBeenCalledWith("[skills] /bad/skill: invalid frontmatter");
    });
  });
});
