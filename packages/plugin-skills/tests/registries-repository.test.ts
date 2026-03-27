import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("../src/skills-repository.js", () => ({
  getPluginContext: vi.fn(),
  initSkillsStorage: vi.fn(),
}));

vi.mock("../src/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { getPluginContext } = await import("../src/skills-repository.js");

describe("registries-repository", () => {
  const mockFindFirst = vi.fn();
  const mockFindMany = vi.fn();
  const mockInsert = vi.fn();
  const mockDelete = vi.fn();
  const mockUpdate = vi.fn();

  const mockRepo = {
    findFirst: mockFindFirst,
    findMany: mockFindMany,
    insert: mockInsert,
    delete: mockDelete,
    update: mockUpdate,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getPluginContext).mockReturnValue({
      storage: {
        register: vi.fn(),
        getRepository: vi.fn(() => mockRepo),
        get: vi.fn(),
        set: vi.fn(),
      },
      log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
    } as any);
  });

  describe("listRegistries", () => {
    it("returns all registries", async () => {
      const { listRegistries } = await import("../src/registries-repository.js");
      mockFindMany.mockResolvedValue([
        { id: "test-reg", url: "https://example.com/registry.json", addedAt: "2026-01-01T00:00:00Z" },
      ]);
      const result = await listRegistries();
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("test-reg");
    });

    it("returns empty array when no registries", async () => {
      const { listRegistries } = await import("../src/registries-repository.js");
      mockFindMany.mockResolvedValue([]);
      const result = await listRegistries();
      expect(result).toEqual([]);
    });
  });

  describe("addRegistry", () => {
    it("inserts a new registry", async () => {
      const { addRegistry } = await import("../src/registries-repository.js");
      mockFindFirst.mockResolvedValue(null);
      const result = await addRegistry("my-reg", "https://example.com/registry.json");
      expect(mockInsert).toHaveBeenCalledWith(
        expect.objectContaining({ id: "my-reg", url: "https://example.com/registry.json" }),
      );
      expect(result.id).toBe("my-reg");
    });

    it("throws if registry name already exists", async () => {
      const { addRegistry } = await import("../src/registries-repository.js");
      mockFindFirst.mockResolvedValue({ id: "my-reg", url: "https://old.com", addedAt: "2026-01-01T00:00:00Z" });
      await expect(addRegistry("my-reg", "https://new.com")).rejects.toThrow("already exists");
    });
  });

  describe("removeRegistry", () => {
    it("deletes an existing registry and returns true", async () => {
      const { removeRegistry } = await import("../src/registries-repository.js");
      mockFindFirst.mockResolvedValue({ id: "my-reg", url: "https://example.com", addedAt: "2026-01-01T00:00:00Z" });
      const result = await removeRegistry("my-reg");
      expect(mockDelete).toHaveBeenCalledWith("my-reg");
      expect(result).toBe(true);
    });

    it("returns false if registry not found", async () => {
      const { removeRegistry } = await import("../src/registries-repository.js");
      mockFindFirst.mockResolvedValue(null);
      const result = await removeRegistry("nonexistent");
      expect(mockDelete).not.toHaveBeenCalled();
      expect(result).toBe(false);
    });
  });

  describe("updateRegistryFetchStatus", () => {
    it("updates lastFetchedAt and clears lastError on success", async () => {
      const { updateRegistryFetchStatus } = await import("../src/registries-repository.js");
      mockFindFirst.mockResolvedValue({ id: "my-reg", url: "https://example.com", addedAt: "2026-01-01T00:00:00Z" });
      await updateRegistryFetchStatus("my-reg", "2026-02-01T00:00:00Z");
      expect(mockUpdate).toHaveBeenCalledWith("my-reg", { lastFetchedAt: "2026-02-01T00:00:00Z", lastError: undefined });
    });

    it("updates lastError when provided", async () => {
      const { updateRegistryFetchStatus } = await import("../src/registries-repository.js");
      mockFindFirst.mockResolvedValue({ id: "my-reg", url: "https://example.com", addedAt: "2026-01-01T00:00:00Z" });
      await updateRegistryFetchStatus("my-reg", "2026-02-01T00:00:00Z", "ECONNREFUSED");
      expect(mockUpdate).toHaveBeenCalledWith("my-reg", {
        lastFetchedAt: "2026-02-01T00:00:00Z",
        lastError: "ECONNREFUSED",
      });
    });
  });
});
