import { describe, it, expect } from "vitest";
import {
  sandboxRegistryRecordSchema,
  sandboxPluginSchema,
} from "../src/sandbox-schema.js";

describe("sandbox-schema", () => {
  describe("sandboxRegistryRecordSchema", () => {
    it("validates a complete record", () => {
      const record = {
        id: "wopr-sbx-test-abc123",
        containerName: "wopr-sbx-test-abc123",
        sessionKey: "test-session",
        createdAtMs: 1700000000000,
        lastUsedAtMs: 1700000001000,
        image: "wopr-sandbox:bookworm-slim",
        configHash: "abc123def456",
      };
      const result = sandboxRegistryRecordSchema.safeParse(record);
      expect(result.success).toBe(true);
    });

    it("validates without optional configHash", () => {
      const record = {
        id: "wopr-sbx-test",
        containerName: "wopr-sbx-test",
        sessionKey: "test",
        createdAtMs: 1700000000000,
        lastUsedAtMs: 1700000000000,
        image: "test:latest",
      };
      const result = sandboxRegistryRecordSchema.safeParse(record);
      expect(result.success).toBe(true);
    });

    it("rejects missing required fields", () => {
      const record = {
        id: "test",
        containerName: "test",
      };
      const result = sandboxRegistryRecordSchema.safeParse(record);
      expect(result.success).toBe(false);
    });

    it("rejects wrong types", () => {
      const record = {
        id: 123,
        containerName: "test",
        sessionKey: "test",
        createdAtMs: "not-a-number",
        lastUsedAtMs: 0,
        image: "test",
      };
      const result = sandboxRegistryRecordSchema.safeParse(record);
      expect(result.success).toBe(false);
    });
  });

  describe("sandboxPluginSchema", () => {
    it("has correct namespace", () => {
      expect(sandboxPluginSchema.namespace).toBe("sandbox");
    });

    it("has version 1", () => {
      expect(sandboxPluginSchema.version).toBe(1);
    });

    it("defines sandbox_registry table", () => {
      expect(sandboxPluginSchema.tables.sandbox_registry).toBeDefined();
      expect(sandboxPluginSchema.tables.sandbox_registry.primaryKey).toBe("id");
    });

    it("has indexes on sessionKey, containerName, and lastUsedAtMs", () => {
      const indexes = sandboxPluginSchema.tables.sandbox_registry.indexes;
      expect(indexes).toContainEqual({ fields: ["sessionKey"] });
      expect(indexes).toContainEqual({ fields: ["containerName"] });
      expect(indexes).toContainEqual({ fields: ["lastUsedAtMs"] });
    });
  });
});
