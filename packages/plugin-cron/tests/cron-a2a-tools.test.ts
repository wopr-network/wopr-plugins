import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("../src/cron-repository.js", () => ({
  initCronStorage: vi.fn(),
  getCrons: vi.fn(() => []),
  getCron: vi.fn(),
  addCron: vi.fn(),
  removeCron: vi.fn(),
  getCronHistory: vi.fn(() => ({ entries: [], total: 0, hasMore: false })),
}));

vi.mock("../src/cron.js", () => ({
  createOnceJob: vi.fn(() => ({
    name: "once-123",
    schedule: "once",
    session: "test",
    message: "hello",
    once: true,
    runAt: Date.now() + 60000,
  })),
  parseCronSchedule: vi.fn(),
  shouldRunCron: vi.fn(),
  parseTimeSpec: vi.fn(),
  resolveScriptTemplates: vi.fn(),
  executeCronScript: vi.fn(),
  executeCronScripts: vi.fn(),
}));

import { buildCronA2ATools } from "../src/cron-a2a-tools.js";
import { addCron, getCrons, removeCron, getCronHistory } from "../src/cron-repository.js";

describe("cron-a2a-tools", () => {
  let config: ReturnType<typeof buildCronA2ATools>;

  beforeEach(() => {
    vi.clearAllMocks();
    config = buildCronA2ATools();
  });

  describe("buildCronA2ATools", () => {
    it("returns config with correct name", () => {
      expect(config.name).toBe("cron");
    });

    it("returns config with correct version", () => {
      expect(config.version).toBe("1.0.0");
    });

    it("registers 5 tools", () => {
      expect(config.tools.length).toBe(5);
    });

    it("has cron_schedule tool", () => {
      const tool = config.tools.find((t) => t.name === "cron_schedule");
      expect(tool).toBeDefined();
      expect(tool!.inputSchema.required).toEqual(["name", "schedule", "session", "message"]);
    });

    it("has cron_once tool", () => {
      const tool = config.tools.find((t) => t.name === "cron_once");
      expect(tool).toBeDefined();
      expect(tool!.inputSchema.required).toEqual(["time", "session", "message"]);
    });

    it("has cron_list tool", () => {
      const tool = config.tools.find((t) => t.name === "cron_list");
      expect(tool).toBeDefined();
    });

    it("has cron_cancel tool", () => {
      const tool = config.tools.find((t) => t.name === "cron_cancel");
      expect(tool).toBeDefined();
      expect(tool!.inputSchema.required).toEqual(["name"]);
    });

    it("has cron_history tool", () => {
      const tool = config.tools.find((t) => t.name === "cron_history");
      expect(tool).toBeDefined();
    });
  });

  describe("cron_schedule handler", () => {
    it("adds a cron job and returns confirmation", async () => {
      const tool = config.tools.find((t) => t.name === "cron_schedule")!;
      const result = await tool.handler({
        name: "daily",
        schedule: "0 9 * * *",
        session: "main",
        message: "Good morning",
      });
      expect(addCron).toHaveBeenCalled();
      expect(result.content[0].text).toContain("daily");
      expect(result.content[0].text).toContain("scheduled");
    });

    it("includes script count when scripts are provided", async () => {
      const tool = config.tools.find((t) => t.name === "cron_schedule")!;
      const result = await tool.handler({
        name: "scripted",
        schedule: "0 9 * * *",
        session: "main",
        message: "Hello {{check}}",
        scripts: [{ name: "check", command: "echo ok" }],
      });
      expect(result.content[0].text).toContain("1 script(s)");
    });
  });

  describe("cron_once handler", () => {
    it("creates and adds a one-time job", async () => {
      const tool = config.tools.find((t) => t.name === "cron_once")!;
      const result = await tool.handler({
        time: "+5m",
        session: "test",
        message: "reminder",
      });
      expect(addCron).toHaveBeenCalled();
      expect(result.content[0].text).toContain("One-time job scheduled");
    });
  });

  describe("cron_list handler", () => {
    it("returns 'no jobs' when empty", async () => {
      vi.mocked(getCrons).mockResolvedValue([]);
      const tool = config.tools.find((t) => t.name === "cron_list")!;
      const result = await tool.handler({});
      expect(result.content[0].text).toContain("No cron jobs");
    });

    it("lists all scheduled jobs", async () => {
      vi.mocked(getCrons).mockResolvedValue([
        { name: "daily", schedule: "0 9 * * *", session: "main", message: "hello" },
        { name: "hourly", schedule: "0 * * * *", session: "main", message: "check" },
      ]);
      const tool = config.tools.find((t) => t.name === "cron_list")!;
      const result = await tool.handler({});
      expect(result.content[0].text).toContain("daily");
      expect(result.content[0].text).toContain("hourly");
    });
  });

  describe("cron_cancel handler", () => {
    it("cancels a job and returns confirmation", async () => {
      vi.mocked(removeCron).mockResolvedValue(true);
      const tool = config.tools.find((t) => t.name === "cron_cancel")!;
      const result = await tool.handler({ name: "daily" });
      expect(removeCron).toHaveBeenCalledWith("daily");
      expect(result.content[0].text).toContain("cancelled");
    });

    it("returns error when job not found", async () => {
      vi.mocked(removeCron).mockResolvedValue(false);
      const tool = config.tools.find((t) => t.name === "cron_cancel")!;
      const result = await tool.handler({ name: "nonexistent" });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("not found");
    });
  });

  describe("cron_history handler", () => {
    it("returns 'no history' when empty", async () => {
      vi.mocked(getCronHistory).mockResolvedValue({ entries: [], total: 0, hasMore: false });
      const tool = config.tools.find((t) => t.name === "cron_history")!;
      const result = await tool.handler({});
      expect(result.content[0].text).toContain("No cron history");
    });

    it("returns formatted history entries", async () => {
      vi.mocked(getCronHistory).mockResolvedValue({
        entries: [
          {
            id: "1",
            cronName: "daily",
            session: "main",
            startedAt: Date.now(),
            status: "success",
            durationMs: 100,
            message: "hello",
          },
        ],
        total: 1,
        hasMore: false,
      });
      const tool = config.tools.find((t) => t.name === "cron_history")!;
      const result = await tool.handler({});
      expect(result.content[0].text).toContain("daily");
      expect(result.content[0].text).toContain("SUCCESS");
    });
  });
});
