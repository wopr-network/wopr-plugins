import { describe, it, expect } from "vitest";
import { skillStateSchema } from "../src/skills-schema.js";

// Import the real schema directly (not through a mock)
// We test the Zod schema validation here, and the plugin schema structure.
const { skillsPluginSchema } = await import("../src/skills-schema.js");

describe("skills-schema", () => {
  describe("skillStateSchema", () => {
    it("validates a complete skill state record", () => {
      const record = {
        id: "test-skill",
        enabled: true,
        installed: true,
        enabledAt: "2025-01-01T00:00:00.000Z",
        lastUsedAt: "2025-01-02T00:00:00.000Z",
        useCount: 5,
      };
      const result = skillStateSchema.safeParse(record);
      expect(result.success).toBe(true);
    });

    it("validates a minimal skill state record", () => {
      const record = {
        id: "test-skill",
        enabled: false,
        installed: true,
        useCount: 0,
      };
      const result = skillStateSchema.safeParse(record);
      expect(result.success).toBe(true);
    });

    it("rejects missing required fields", () => {
      const record = { id: "test" };
      const result = skillStateSchema.safeParse(record);
      expect(result.success).toBe(false);
    });
  });

  describe("skillsPluginSchema", () => {
    it("has correct namespace", () => {
      expect(skillsPluginSchema.namespace).toBe("skills");
    });

    it("has version 2", () => {
      expect(skillsPluginSchema.version).toBe(2);
    });

    it("defines skills_state table", () => {
      expect(skillsPluginSchema.tables.skills_state).toBeDefined();
    });

    it("uses id as primary key", () => {
      expect(skillsPluginSchema.tables.skills_state.primaryKey).toBe("id");
    });

    it("has indexes on enabled and lastUsedAt", () => {
      const indexes = skillsPluginSchema.tables.skills_state.indexes;
      expect(indexes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ fields: ["enabled"] }),
          expect.objectContaining({ fields: ["lastUsedAt"] }),
        ]),
      );
    });
  });
});
