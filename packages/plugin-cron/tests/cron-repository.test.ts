import { vi, describe, it, expect, beforeEach } from "vitest";
import { initCronStorage, getCrons, getCron, addCron, removeCron, addCronRun } from "../src/cron-repository.js";

describe("cron-repository", () => {
  const mockFindMany = vi.fn();
  const mockFindById = vi.fn();
  const mockInsert = vi.fn();
  const mockUpdate = vi.fn();
  const mockDelete = vi.fn();
  const mockCount = vi.fn();
  const mockDeleteMany = vi.fn();

  const mockJobsRepo = {
    findMany: mockFindMany,
    findById: mockFindById,
    insert: mockInsert,
    update: mockUpdate,
    delete: mockDelete,
  };

  const mockRunsInsert = vi.fn();
  const mockRunsRepo = {
    insert: mockRunsInsert,
    findMany: vi.fn(),
    count: mockCount,
    deleteMany: mockDeleteMany,
    query: vi.fn(() => ({
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      offset: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      execute: vi.fn(() => []),
    })),
  };

  const mockStorage = {
    register: vi.fn(),
    getRepository: vi.fn((namespace: string, table: string) => {
      if (table === "jobs") return mockJobsRepo;
      if (table === "runs") return mockRunsRepo;
      return null;
    }),
  } as any;

  beforeEach(async () => {
    vi.clearAllMocks();
    await initCronStorage(mockStorage);
  });

  describe("initCronStorage", () => {
    it("registers the cron plugin schema", () => {
      expect(mockStorage.register).toHaveBeenCalled();
    });

    it("gets jobs and runs repositories", () => {
      expect(mockStorage.getRepository).toHaveBeenCalledWith("cron", "jobs");
      expect(mockStorage.getRepository).toHaveBeenCalledWith("cron", "runs");
    });
  });

  describe("getCrons", () => {
    it("returns all cron jobs", async () => {
      const jobs = [{ name: "test", schedule: "* * * * *", session: "s", message: "m" }];
      mockFindMany.mockResolvedValue(jobs);
      const result = await getCrons();
      expect(result).toEqual(jobs);
    });

    it("returns empty array when no jobs", async () => {
      mockFindMany.mockResolvedValue([]);
      const result = await getCrons();
      expect(result).toEqual([]);
    });
  });

  describe("getCron", () => {
    it("returns a cron job by name", async () => {
      const job = { name: "test", schedule: "* * * * *", session: "s", message: "m" };
      mockFindById.mockResolvedValue(job);
      const result = await getCron("test");
      expect(result).toEqual(job);
      expect(mockFindById).toHaveBeenCalledWith("test");
    });

    it("returns null when job not found", async () => {
      mockFindById.mockResolvedValue(null);
      const result = await getCron("nonexistent");
      expect(result).toBeNull();
    });
  });

  describe("addCron", () => {
    it("inserts a new cron job when it does not exist", async () => {
      mockFindById.mockResolvedValue(null);
      const job = { name: "new-job", schedule: "0 9 * * *", session: "main", message: "hello" };
      await addCron(job);
      expect(mockInsert).toHaveBeenCalledWith(job);
    });

    it("updates an existing cron job", async () => {
      const existing = { name: "existing", schedule: "0 9 * * *", session: "main", message: "old" };
      mockFindById.mockResolvedValue(existing);
      const updated = { ...existing, message: "new" };
      await addCron(updated);
      expect(mockUpdate).toHaveBeenCalledWith("existing", updated);
    });
  });

  describe("removeCron", () => {
    it("deletes a cron job by name", async () => {
      mockDelete.mockResolvedValue(true);
      const result = await removeCron("test");
      expect(result).toBe(true);
      expect(mockDelete).toHaveBeenCalledWith("test");
    });

    it("returns false when job not found", async () => {
      mockDelete.mockResolvedValue(false);
      const result = await removeCron("nonexistent");
      expect(result).toBe(false);
    });
  });

  describe("addCronRun", () => {
    it("inserts a run entry with auto-generated id", async () => {
      const run = {
        cronName: "test",
        session: "main",
        startedAt: Date.now(),
        status: "success" as const,
        durationMs: 100,
        message: "done",
      };
      await addCronRun(run);
      expect(mockRunsInsert).toHaveBeenCalledWith(
        expect.objectContaining({
          ...run,
          id: expect.any(String),
        }),
      );
    });
  });
});
