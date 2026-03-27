import { describe, it, expect } from "vitest";
import {
  parseSkillFrontmatter,
  validateSkillName,
  validateSkillDescription,
  validateFrontmatterFields,
} from "../src/skill-frontmatter-parser.js";

describe("skill-frontmatter-parser", () => {
  describe("parseSkillFrontmatter", () => {
    it("parses valid frontmatter with name and description", () => {
      const content = `---
name: my-skill
description: A useful skill
---

# My Skill`;

      const { frontmatter, body } = parseSkillFrontmatter(content);
      expect(frontmatter.name).toBe("my-skill");
      expect(frontmatter.description).toBe("A useful skill");
      expect(body.trim()).toBe("# My Skill");
    });

    it("returns empty frontmatter when no frontmatter block present", () => {
      const content = "# Just a markdown file";
      const { frontmatter, body } = parseSkillFrontmatter(content);
      expect(frontmatter).toEqual({});
      expect(body).toBe(content);
    });

    it("parses metadata as JSON when valid", () => {
      const content = `---
name: test
description: test skill
metadata: {"wopr": {"emoji": "🔧"}}
---
`;
      const { frontmatter } = parseSkillFrontmatter(content);
      expect(frontmatter.metadata).toEqual({ wopr: { emoji: "🔧" } });
    });

    it("keeps metadata as string when not valid JSON", () => {
      const content = `---
name: test
description: test skill
metadata: not-json
---
`;
      const { frontmatter } = parseSkillFrontmatter(content);
      expect(frontmatter.metadata).toBe("not-json");
    });

    it("parses allowed-tools as JSON array", () => {
      const content = `---
name: test
description: test skill
allowed-tools: ["Bash", "Read"]
---
`;
      const { frontmatter } = parseSkillFrontmatter(content);
      expect(frontmatter["allowed-tools"]).toEqual(["Bash", "Read"]);
    });

    it("parses allowed-tools as comma-separated when not JSON", () => {
      const content = `---
name: test
description: test skill
allowed-tools: Bash, Read, Write
---
`;
      const { frontmatter } = parseSkillFrontmatter(content);
      expect(frontmatter["allowed-tools"]).toEqual(["Bash", "Read", "Write"]);
    });

    it("warns on unknown frontmatter fields", () => {
      const content = `---
name: test
description: test skill
unknown-field: value
---
`;
      const { warnings } = parseSkillFrontmatter(content);
      expect(warnings.length).toBeGreaterThan(0);
      expect(warnings[0].message).toContain("unknown frontmatter field");
    });

    it("parses command-dispatch and command-tool", () => {
      const content = `---
name: test
description: test skill
command-dispatch: tool
command-tool: Bash
command-arg-mode: raw
---
`;
      const { frontmatter } = parseSkillFrontmatter(content);
      expect(frontmatter["command-dispatch"]).toBe("tool");
      expect(frontmatter["command-tool"]).toBe("Bash");
      expect(frontmatter["command-arg-mode"]).toBe("raw");
    });
  });

  describe("validateSkillName", () => {
    it("returns no errors for valid name matching directory", () => {
      const errors = validateSkillName("my-skill", "my-skill");
      expect(errors).toEqual([]);
    });

    it("returns error when name does not match parent directory", () => {
      const errors = validateSkillName("my-skill", "other-dir");
      expect(errors.some((e) => e.includes("does not match parent directory"))).toBe(true);
    });

    it("returns error for names exceeding max length", () => {
      const longName = "a".repeat(65);
      const errors = validateSkillName(longName, longName);
      expect(errors.some((e) => e.includes("exceeds"))).toBe(true);
    });

    it("returns error for names with invalid characters", () => {
      const errors = validateSkillName("My_Skill", "My_Skill");
      expect(errors.some((e) => e.includes("invalid characters"))).toBe(true);
    });

    it("returns error for names starting with hyphen", () => {
      const errors = validateSkillName("-my-skill", "-my-skill");
      expect(errors.some((e) => e.includes("start or end with a hyphen"))).toBe(true);
    });

    it("returns error for names ending with hyphen", () => {
      const errors = validateSkillName("my-skill-", "my-skill-");
      expect(errors.some((e) => e.includes("start or end with a hyphen"))).toBe(true);
    });

    it("returns error for names with consecutive hyphens", () => {
      const errors = validateSkillName("my--skill", "my--skill");
      expect(errors.some((e) => e.includes("consecutive hyphens"))).toBe(true);
    });
  });

  describe("validateSkillDescription", () => {
    it("returns no errors for valid description", () => {
      const errors = validateSkillDescription("A useful skill");
      expect(errors).toEqual([]);
    });

    it("returns error for missing description", () => {
      const errors = validateSkillDescription(undefined);
      expect(errors.some((e) => e.includes("required"))).toBe(true);
    });

    it("returns error for empty description", () => {
      const errors = validateSkillDescription("");
      expect(errors.some((e) => e.includes("required"))).toBe(true);
    });

    it("returns error for whitespace-only description", () => {
      const errors = validateSkillDescription("   ");
      expect(errors.some((e) => e.includes("required"))).toBe(true);
    });

    it("returns error for description exceeding max length", () => {
      const longDesc = "a".repeat(1025);
      const errors = validateSkillDescription(longDesc);
      expect(errors.some((e) => e.includes("exceeds"))).toBe(true);
    });
  });

  describe("validateFrontmatterFields", () => {
    it("returns no errors for allowed fields", () => {
      const errors = validateFrontmatterFields(["name", "description", "metadata"]);
      expect(errors).toEqual([]);
    });

    it("returns errors for unknown fields", () => {
      const errors = validateFrontmatterFields(["name", "unknown-field"]);
      expect(errors.length).toBe(1);
      expect(errors[0]).toContain("unknown-field");
    });
  });
});
