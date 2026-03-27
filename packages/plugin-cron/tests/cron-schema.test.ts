import { describe, it, expect } from "vitest";
import {
  cronJobSchema,
  cronRunSchema,
  cronScriptSchema,
  cronScriptResultSchema,
  cronPluginSchema,
} from "../src/cron-schema.js";

describe("cron-schema", () => {
  describe("cronScriptSchema", () => {
    it("validates a complete script", () => {
      const result = cronScriptSchema.safeParse({
        name: "check-disk",
        command: "df -h",
        timeout: 5000,
        cwd: "/tmp",
      });
      expect(result.success).toBe(true);
    });

    it("validates a minimal script (name + command only)", () => {
      const result = cronScriptSchema.safeParse({
        name: "hello",
        command: "echo hello",
      });
      expect(result.success).toBe(true);
    });

    it("rejects missing name", () => {
      const result = cronScriptSchema.safeParse({ command: "echo" });
      expect(result.success).toBe(false);
    });

    it("rejects missing command", () => {
      const result = cronScriptSchema.safeParse({ name: "test" });
      expect(result.success).toBe(false);
    });
  });

  describe("cronScriptResultSchema", () => {
    it("validates a successful result", () => {
      const result = cronScriptResultSchema.safeParse({
        name: "test",
        exitCode: 0,
        stdout: "output",
        stderr: "",
        durationMs: 100,
      });
      expect(result.success).toBe(true);
    });

    it("validates a failed result with error", () => {
      const result = cronScriptResultSchema.safeParse({
        name: "test",
        exitCode: 1,
        stdout: "",
        stderr: "error output",
        durationMs: 50,
        error: "command not found",
      });
      expect(result.success).toBe(true);
    });
  });

  describe("cronJobSchema", () => {
    it("validates a recurring job", () => {
      const result = cronJobSchema.safeParse({
        name: "daily-report",
        schedule: "0 9 * * *",
        session: "main",
        message: "Time for the daily report",
      });
      expect(result.success).toBe(true);
    });

    it("validates a once job with runAt", () => {
      const result = cronJobSchema.safeParse({
        name: "once-123",
        schedule: "once",
        session: "main",
        message: "One-time message",
        once: true,
        runAt: Date.now() + 60000,
      });
      expect(result.success).toBe(true);
    });

    it("validates a job with scripts", () => {
      const result = cronJobSchema.safeParse({
        name: "scripted-job",
        schedule: "*/5 * * * *",
        session: "main",
        message: "Disk usage: {{disk-check}}",
        scripts: [{ name: "disk-check", command: "df -h /" }],
      });
      expect(result.success).toBe(true);
    });

    it("rejects missing required fields", () => {
      const result = cronJobSchema.safeParse({ name: "test" });
      expect(result.success).toBe(false);
    });
  });

  describe("cronRunSchema", () => {
    it("validates a successful run", () => {
      const result = cronRunSchema.safeParse({
        id: "uuid-123",
        cronName: "daily-report",
        session: "main",
        startedAt: Date.now(),
        status: "success",
        durationMs: 500,
        message: "Report sent",
      });
      expect(result.success).toBe(true);
    });

    it("validates a failed run with error", () => {
      const result = cronRunSchema.safeParse({
        id: "uuid-456",
        cronName: "daily-report",
        session: "main",
        startedAt: Date.now(),
        status: "failure",
        durationMs: 100,
        error: "Session not found",
        message: "Report sent",
      });
      expect(result.success).toBe(true);
    });

    it("rejects invalid status", () => {
      const result = cronRunSchema.safeParse({
        id: "uuid-789",
        cronName: "test",
        session: "main",
        startedAt: Date.now(),
        status: "unknown",
        durationMs: 0,
        message: "test",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("cronPluginSchema", () => {
    it("has correct namespace", () => {
      expect(cronPluginSchema.namespace).toBe("cron");
    });

    it("has version 1", () => {
      expect(cronPluginSchema.version).toBe(1);
    });

    it("defines jobs table with name as primary key", () => {
      expect(cronPluginSchema.tables.jobs).toBeDefined();
      expect(cronPluginSchema.tables.jobs.primaryKey).toBe("name");
    });

    it("defines runs table with id as primary key", () => {
      expect(cronPluginSchema.tables.runs).toBeDefined();
      expect(cronPluginSchema.tables.runs.primaryKey).toBe("id");
    });

    it("has indexes on jobs table", () => {
      const indexes = cronPluginSchema.tables.jobs.indexes;
      expect(indexes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ fields: ["session"] }),
          expect.objectContaining({ fields: ["schedule"] }),
          expect.objectContaining({ fields: ["runAt"] }),
        ]),
      );
    });

    it("has indexes on runs table", () => {
      const indexes = cronPluginSchema.tables.runs.indexes;
      expect(indexes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ fields: ["cronName"] }),
          expect.objectContaining({ fields: ["session"] }),
          expect.objectContaining({ fields: ["startedAt"] }),
          expect.objectContaining({ fields: ["status"] }),
        ]),
      );
    });
  });
});
