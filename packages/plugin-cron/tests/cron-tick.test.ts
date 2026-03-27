import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("../src/cron-repository.js", () => ({
  initCronStorage: vi.fn(),
  getCrons: vi.fn(() => []),
  removeCron: vi.fn(),
  addCronRun: vi.fn(),
}));

vi.mock("../src/cron.js", () => ({
  shouldRunCron: vi.fn(() => false),
  executeCronScripts: vi.fn(() => []),
  resolveScriptTemplates: vi.fn((msg: string) => msg),
  parseCronSchedule: vi.fn(),
  parseTimeSpec: vi.fn(),
  createOnceJob: vi.fn(),
  executeCronScript: vi.fn(),
}));

import { createCronTickLoop } from "../src/cron-tick.js";
import { getCrons, removeCron, addCronRun } from "../src/cron-repository.js";
import { shouldRunCron } from "../src/cron.js";

describe("cron-tick", () => {
  let mockCtx: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockCtx = {
      log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
      inject: vi.fn(() => Promise.resolve()),
      getMainConfig: vi.fn(() => undefined),
      getConfig: vi.fn(() => ({})),
    };
  });

  describe("createCronTickLoop", () => {
    it("returns a function", () => {
      const tick = createCronTickLoop(mockCtx);
      expect(typeof tick).toBe("function");
    });

    it("does nothing when no crons exist", async () => {
      vi.mocked(getCrons).mockResolvedValue([]);
      const tick = createCronTickLoop(mockCtx);
      await tick();
      expect(mockCtx.inject).not.toHaveBeenCalled();
    });

    it("executes a recurring cron when schedule matches", async () => {
      vi.mocked(getCrons).mockResolvedValue([
        { name: "test", schedule: "* * * * *", session: "main", message: "hello" },
      ]);
      vi.mocked(shouldRunCron).mockReturnValue(true);

      const tick = createCronTickLoop(mockCtx);
      await tick();

      expect(mockCtx.inject).toHaveBeenCalledWith("main", "hello", { from: "cron", silent: true, source: { type: "cron", trustLevel: "owner", identity: { pluginName: "wopr-plugin-cron" } } });
    });

    it("records a successful run in history", async () => {
      vi.mocked(getCrons).mockResolvedValue([
        { name: "test", schedule: "* * * * *", session: "main", message: "hello" },
      ]);
      vi.mocked(shouldRunCron).mockReturnValue(true);

      const tick = createCronTickLoop(mockCtx);
      await tick();

      expect(addCronRun).toHaveBeenCalledWith(
        expect.objectContaining({
          cronName: "test",
          session: "main",
          status: "success",
          message: "hello",
        }),
      );
    });

    it("executes a one-time job when runAt has passed", async () => {
      vi.mocked(getCrons).mockResolvedValue([
        { name: "once-1", schedule: "once", session: "main", message: "one-time", once: true, runAt: Date.now() - 1000 },
      ]);

      const tick = createCronTickLoop(mockCtx);
      await tick();

      expect(mockCtx.inject).toHaveBeenCalledWith("main", "one-time", { from: "cron", silent: true, source: { type: "cron", trustLevel: "owner", identity: { pluginName: "wopr-plugin-cron" } } });
    });

    it("removes one-time jobs after execution", async () => {
      vi.mocked(getCrons).mockResolvedValue([
        { name: "once-1", schedule: "once", session: "main", message: "one-time", once: true, runAt: Date.now() - 1000 },
      ]);

      const tick = createCronTickLoop(mockCtx);
      await tick();

      expect(removeCron).toHaveBeenCalledWith("once-1");
    });

    it("records a failure when inject throws", async () => {
      vi.mocked(getCrons).mockResolvedValue([
        { name: "fail-job", schedule: "* * * * *", session: "main", message: "hello" },
      ]);
      vi.mocked(shouldRunCron).mockReturnValue(true);
      mockCtx.inject.mockRejectedValue(new Error("injection failed"));

      const tick = createCronTickLoop(mockCtx);
      await tick();

      expect(addCronRun).toHaveBeenCalledWith(
        expect.objectContaining({
          cronName: "fail-job",
          status: "failure",
          error: "injection failed",
        }),
      );
    });

    it("does not re-run a cron in the same minute", async () => {
      vi.mocked(getCrons).mockResolvedValue([
        { name: "test", schedule: "* * * * *", session: "main", message: "hello" },
      ]);
      vi.mocked(shouldRunCron).mockReturnValue(true);

      const tick = createCronTickLoop(mockCtx);
      await tick();
      expect(mockCtx.inject).toHaveBeenCalledTimes(1);

      // Running again in same minute should not fire
      await tick();
      expect(mockCtx.inject).toHaveBeenCalledTimes(1);
    });
  });
});
