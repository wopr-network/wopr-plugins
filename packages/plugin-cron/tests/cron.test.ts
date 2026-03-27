import { describe, it, expect } from "vitest";
import {
  parseCronSchedule,
  shouldRunCron,
  parseTimeSpec,
  createOnceJob,
  resolveScriptTemplates,
} from "../src/cron.js";

describe("cron", () => {
  describe("parseCronSchedule", () => {
    it("parses '* * * * *' as every minute", () => {
      const result = parseCronSchedule("* * * * *");
      expect(result.minute.length).toBe(60);
      expect(result.hour.length).toBe(24);
      expect(result.day.length).toBe(31);
      expect(result.month.length).toBe(12);
      expect(result.weekday.length).toBe(7);
    });

    it("parses specific values", () => {
      const result = parseCronSchedule("30 9 1 1 0");
      expect(result.minute).toEqual([30]);
      expect(result.hour).toEqual([9]);
      expect(result.day).toEqual([1]);
      expect(result.month).toEqual([1]);
      expect(result.weekday).toEqual([0]);
    });

    it("parses step values", () => {
      const result = parseCronSchedule("*/15 * * * *");
      expect(result.minute).toEqual([0, 15, 30, 45]);
    });

    it("parses comma-separated values", () => {
      const result = parseCronSchedule("0,30 * * * *");
      expect(result.minute).toEqual([0, 30]);
    });

    it("parses ranges", () => {
      const result = parseCronSchedule("0-4 * * * *");
      expect(result.minute).toEqual([0, 1, 2, 3, 4]);
    });

    it("throws for invalid schedule (wrong number of parts)", () => {
      expect(() => parseCronSchedule("* * *")).toThrow("Invalid cron schedule");
    });

    it("throws for out-of-range values", () => {
      expect(() => parseCronSchedule("60 * * * *")).toThrow();
    });

    it("throws for invalid step", () => {
      expect(() => parseCronSchedule("*/0 * * * *")).toThrow();
    });

    it("throws for invalid range", () => {
      expect(() => parseCronSchedule("5-2 * * * *")).toThrow();
    });
  });

  describe("shouldRunCron", () => {
    it("returns true when schedule matches current time", () => {
      const date = new Date(2025, 0, 1, 9, 30); // Jan 1 2025, 9:30 AM, Wednesday (3)
      expect(shouldRunCron("30 9 1 1 3", date)).toBe(true);
    });

    it("returns false when minute does not match", () => {
      const date = new Date(2025, 0, 1, 9, 31);
      expect(shouldRunCron("30 9 * * *", date)).toBe(false);
    });

    it("returns false when hour does not match", () => {
      const date = new Date(2025, 0, 1, 10, 30);
      expect(shouldRunCron("30 9 * * *", date)).toBe(false);
    });

    it("returns true for wildcard schedule at any time", () => {
      const date = new Date();
      expect(shouldRunCron("* * * * *", date)).toBe(true);
    });

    it("returns false for invalid schedule", () => {
      const date = new Date();
      expect(shouldRunCron("invalid", date)).toBe(false);
    });
  });

  describe("parseTimeSpec", () => {
    it("parses 'now' as current time", () => {
      const before = Date.now();
      const result = parseTimeSpec("now");
      const after = Date.now();
      expect(result).toBeGreaterThanOrEqual(before);
      expect(result).toBeLessThanOrEqual(after);
    });

    it("parses relative minutes (+5m)", () => {
      const before = Date.now();
      const result = parseTimeSpec("+5m");
      expect(result).toBeGreaterThanOrEqual(before + 5 * 60000 - 100);
      expect(result).toBeLessThanOrEqual(before + 5 * 60000 + 100);
    });

    it("parses relative hours (+1h)", () => {
      const before = Date.now();
      const result = parseTimeSpec("+1h");
      expect(result).toBeGreaterThanOrEqual(before + 3600000 - 100);
    });

    it("parses relative seconds (+30s)", () => {
      const before = Date.now();
      const result = parseTimeSpec("+30s");
      expect(result).toBeGreaterThanOrEqual(before + 30000 - 100);
    });

    it("parses relative days (+1d)", () => {
      const before = Date.now();
      const result = parseTimeSpec("+1d");
      expect(result).toBeGreaterThanOrEqual(before + 86400000 - 100);
    });

    it("parses Unix timestamp in seconds", () => {
      const result = parseTimeSpec("1700000000");
      expect(result).toBe(1700000000000);
    });

    it("parses Unix timestamp in milliseconds", () => {
      const result = parseTimeSpec("1700000000000");
      expect(result).toBe(1700000000000);
    });

    it("parses HH:MM time", () => {
      const result = parseTimeSpec("14:30");
      const d = new Date(result);
      expect(d.getHours()).toBe(14);
      expect(d.getMinutes()).toBe(30);
    });

    it("parses ISO date string", () => {
      const result = parseTimeSpec("2025-06-15T10:00:00Z");
      expect(result).toBe(Date.parse("2025-06-15T10:00:00Z"));
    });

    it("throws for invalid time spec", () => {
      expect(() => parseTimeSpec("not-a-time")).toThrow("Invalid time spec");
    });
  });

  describe("createOnceJob", () => {
    it("creates a one-time job with correct fields", () => {
      const job = createOnceJob("+5m", "test-session", "Hello world");
      expect(job.schedule).toBe("once");
      expect(job.session).toBe("test-session");
      expect(job.message).toBe("Hello world");
      expect(job.once).toBe(true);
      expect(job.runAt).toBeGreaterThan(Date.now() - 1000);
    });

    it("generates a unique name starting with 'once-'", () => {
      const job = createOnceJob("now", "session", "msg");
      expect(job.name).toMatch(/^once-\d+$/);
    });
  });

  describe("resolveScriptTemplates", () => {
    it("replaces placeholder with script stdout", () => {
      const message = "Result: {{my-script}}";
      const results = [{ name: "my-script", exitCode: 0, stdout: "42\n", stderr: "", durationMs: 10 }];
      expect(resolveScriptTemplates(message, results)).toBe("Result: 42");
    });

    it("replaces multiple placeholders", () => {
      const message = "A: {{a}}, B: {{b}}";
      const results = [
        { name: "a", exitCode: 0, stdout: "foo\n", stderr: "", durationMs: 5 },
        { name: "b", exitCode: 0, stdout: "bar\n", stderr: "", durationMs: 5 },
      ];
      expect(resolveScriptTemplates(message, results)).toBe("A: foo, B: bar");
    });

    it("includes error marker when script failed", () => {
      const message = "Result: {{fail-script}}";
      const results = [
        { name: "fail-script", exitCode: 1, stdout: "", stderr: "err", durationMs: 5, error: "command failed" },
      ];
      const resolved = resolveScriptTemplates(message, results);
      expect(resolved).toContain("[script error: command failed]");
    });

    it("includes stdout before error marker when both present", () => {
      const message = "{{s}}";
      const results = [
        { name: "s", exitCode: 1, stdout: "partial output\n", stderr: "", durationMs: 5, error: "timeout" },
      ];
      const resolved = resolveScriptTemplates(message, results);
      expect(resolved).toContain("partial output");
      expect(resolved).toContain("[script error: timeout]");
    });

    it("leaves message unchanged when no placeholders match", () => {
      const message = "No placeholders here";
      const results = [{ name: "other", exitCode: 0, stdout: "val", stderr: "", durationMs: 5 }];
      expect(resolveScriptTemplates(message, results)).toBe("No placeholders here");
    });
  });
});
