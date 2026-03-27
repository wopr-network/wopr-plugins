import { vi, describe, it, expect, beforeEach } from "vitest";

// Import with dynamic import to get fresh module
const { setPluginContext, resetSkillsStorageInit, initSkillsStorage } = await import("../src/skills-repository.js");
const { skillsPluginSchema } = await import("../src/skills-schema.js");

describe("skills-repository", () => {
  const mockFindFirst = vi.fn();
  const mockFindMany = vi.fn();
  const mockInsert = vi.fn();
  const mockUpdate = vi.fn();
  const mockDelete = vi.fn();

  const mockRepo = {
    findFirst: mockFindFirst,
    findMany: mockFindMany,
    insert: mockInsert,
    update: mockUpdate,
    delete: mockDelete,
  };

  let mockCtx: any;

  beforeEach(() => {
    vi.clearAllMocks();
    resetSkillsStorageInit();
    mockCtx = {
      storage: {
        register: vi.fn(),
        getRepository: vi.fn(() => mockRepo),
        get: vi.fn(),
        set: vi.fn(),
      },
      log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
    };
  });

  describe("initSkillsStorage", () => {
    it("registers schema on first call", async () => {
      setPluginContext(mockCtx);
      await initSkillsStorage();
      expect(mockCtx.storage.register).toHaveBeenCalledWith(skillsPluginSchema);
    });

    it("is idempotent - does not register twice", async () => {
      setPluginContext(mockCtx);
      await initSkillsStorage();
      await initSkillsStorage();
      expect(mockCtx.storage.register).toHaveBeenCalledTimes(1);
    });
  });

  describe("resetSkillsStorageInit", () => {
    it("allows re-initialization after reset", async () => {
      setPluginContext(mockCtx);
      await initSkillsStorage();
      expect(mockCtx.storage.register).toHaveBeenCalledTimes(1);

      resetSkillsStorageInit();
      await initSkillsStorage();
      expect(mockCtx.storage.register).toHaveBeenCalledTimes(2);
    });
  });
});
