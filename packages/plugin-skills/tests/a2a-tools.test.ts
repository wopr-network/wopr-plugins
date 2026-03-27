import { vi, describe, it, expect, beforeEach } from "vitest";

// Keep logger mock simple
vi.mock("../src/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock skills.js to avoid filesystem dependencies
vi.mock("../src/skills.js", () => ({
  discoverSkills: vi.fn(() => ({ skills: [], warnings: [] })),
  enableSkillAsync: vi.fn(() => Promise.resolve(true)),
  disableSkillAsync: vi.fn(() => Promise.resolve(true)),
  getSkillByName: vi.fn(() => null),
  readAllSkillStatesAsync: vi.fn(() => Promise.resolve({})),
}));

// We need to re-import after mocks are set up
const { setA2AContext, registerSkillsA2ATools, unregisterSkillsA2ATools } = await import("../src/a2a-tools.js");

describe("a2a-tools", () => {
  let mockCtx: any;
  let registeredConfig: any;

  beforeEach(() => {
    vi.clearAllMocks();
    registeredConfig = null;
    mockCtx = {
      registerA2AServer: vi.fn((config: any) => {
        registeredConfig = config;
      }),
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    };
    // Set context before each test
    setA2AContext(mockCtx);
  });

  describe("registerSkillsA2ATools", () => {
    it("registers A2A server with correct name and version", () => {
      registerSkillsA2ATools();
      expect(mockCtx.registerA2AServer).toHaveBeenCalled();
      expect(registeredConfig.name).toBe("wopr-plugin-skills");
      expect(registeredConfig.version).toBe("1.0.0");
    });

    it("registers 4 tools", () => {
      registerSkillsA2ATools();
      expect(registeredConfig.tools.length).toBe(4);
    });

    it("registers skills.list tool", () => {
      registerSkillsA2ATools();
      const tool = registeredConfig.tools.find((t: any) => t.name === "skills.list");
      expect(tool).toBeDefined();
      expect(tool.description).toContain("List");
    });

    it("registers skills.enable tool", () => {
      registerSkillsA2ATools();
      const tool = registeredConfig.tools.find((t: any) => t.name === "skills.enable");
      expect(tool).toBeDefined();
      expect(tool.inputSchema.required).toContain("name");
    });

    it("registers skills.disable tool", () => {
      registerSkillsA2ATools();
      const tool = registeredConfig.tools.find((t: any) => t.name === "skills.disable");
      expect(tool).toBeDefined();
      expect(tool.inputSchema.required).toContain("name");
    });

    it("registers skills.info tool", () => {
      registerSkillsA2ATools();
      const tool = registeredConfig.tools.find((t: any) => t.name === "skills.info");
      expect(tool).toBeDefined();
      expect(tool.inputSchema.required).toContain("name");
    });

    it("does not throw when registerA2AServer is not available", () => {
      setA2AContext({ log: mockCtx.log } as any);
      expect(() => registerSkillsA2ATools()).not.toThrow();
    });
  });

  describe("skills.list handler", () => {
    it("returns skills list as JSON text content", async () => {
      registerSkillsA2ATools();
      const tool = registeredConfig.tools.find((t: any) => t.name === "skills.list");
      const result = await tool.handler({});
      expect(result.content[0].type).toBe("text");
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.skills).toBeDefined();
      expect(Array.isArray(parsed.skills)).toBe(true);
    });
  });

  describe("skills.info handler", () => {
    it("returns error content when skill not found", async () => {
      registerSkillsA2ATools();
      const tool = registeredConfig.tools.find((t: any) => t.name === "skills.info");
      const result = await tool.handler({ name: "nonexistent" });
      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.error).toBe("Skill not found");
    });
  });

  describe("unregisterSkillsA2ATools", () => {
    it("does not throw", () => {
      expect(() => unregisterSkillsA2ATools()).not.toThrow();
    });
  });
});
