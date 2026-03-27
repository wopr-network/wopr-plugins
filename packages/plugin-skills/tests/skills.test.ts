import { vi, describe, it, expect } from "vitest";

// We need to test the pure functions from skills.ts without mocking the module itself.
// Use dynamic import to get a fresh copy.
const {
  formatSkillsXml,
  buildSkillsPrompt,
  buildSkillCommandSpecs,
  describeInstallStep,
  checkSkillDependencies,
} = await import("../src/skills.js");

type Skill = import("../src/skills.js").Skill;
type SkillInstallStep = import("../src/skills.js").SkillInstallStep;

describe("skills", () => {
  describe("formatSkillsXml", () => {
    it("returns empty string for empty skills array", () => {
      expect(formatSkillsXml([])).toBe("");
    });

    it("formats single skill as XML", () => {
      const skills: Skill[] = [
        { name: "test-skill", description: "A test skill", path: "/skills/test-skill/SKILL.md", baseDir: "/skills/test-skill", source: "managed" },
      ];
      const xml = formatSkillsXml(skills);
      expect(xml).toContain("<available_skills>");
      expect(xml).toContain("<name>test-skill</name>");
      expect(xml).toContain("<description>A test skill</description>");
      expect(xml).toContain("<location>/skills/test-skill/SKILL.md</location>");
      expect(xml).toContain("</available_skills>");
    });

    it("includes emoji in description when present", () => {
      const skills: Skill[] = [
        {
          name: "emoji-skill",
          description: "A skill with emoji",
          path: "/test",
          baseDir: "/test",
          source: "managed",
          metadata: { emoji: "🔧" },
        },
      ];
      const xml = formatSkillsXml(skills);
      expect(xml).toContain("🔧 A skill with emoji");
    });

    it("formats multiple skills", () => {
      const skills: Skill[] = [
        { name: "skill-a", description: "First", path: "/a", baseDir: "/a", source: "managed" },
        { name: "skill-b", description: "Second", path: "/b", baseDir: "/b", source: "workspace" },
      ];
      const xml = formatSkillsXml(skills);
      expect(xml).toContain("<name>skill-a</name>");
      expect(xml).toContain("<name>skill-b</name>");
    });
  });

  describe("buildSkillsPrompt", () => {
    it("delegates to formatSkillsXml", () => {
      const skills: Skill[] = [
        { name: "test", description: "test", path: "/test", baseDir: "/test", source: "managed" },
      ];
      const prompt = buildSkillsPrompt(skills);
      expect(prompt).toContain("<available_skills>");
    });
  });

  describe("buildSkillCommandSpecs", () => {
    it("returns empty array for skills without commandDispatch", () => {
      const skills: Skill[] = [
        { name: "test", description: "No dispatch", path: "/test", baseDir: "/test", source: "managed" },
      ];
      const specs = buildSkillCommandSpecs(skills);
      expect(specs).toEqual([]);
    });

    it("builds specs for skills with commandDispatch", () => {
      const skills: Skill[] = [
        {
          name: "my-tool",
          description: "A tool skill",
          path: "/test",
          baseDir: "/test",
          source: "managed",
          commandDispatch: { kind: "tool", toolName: "Bash", argMode: "raw" },
        },
      ];
      const specs = buildSkillCommandSpecs(skills);
      expect(specs.length).toBe(1);
      expect(specs[0].name).toBe("my_tool");
      expect(specs[0].skillName).toBe("my-tool");
      expect(specs[0].description).toBe("A tool skill");
      expect(specs[0].dispatch).toEqual({ kind: "tool", toolName: "Bash", argMode: "raw" });
    });

    it("handles reserved names by appending suffix", () => {
      const skills: Skill[] = [
        {
          name: "help",
          description: "A help skill",
          path: "/test",
          baseDir: "/test",
          source: "managed",
          commandDispatch: { kind: "tool", toolName: "Bash", argMode: "raw" },
        },
      ];
      const specs = buildSkillCommandSpecs(skills, ["help"]);
      expect(specs.length).toBe(1);
      expect(specs[0].name).not.toBe("help");
      expect(specs[0].name).toBe("help_2");
    });

    it("truncates long descriptions", () => {
      const skills: Skill[] = [
        {
          name: "long-desc",
          description: "A".repeat(200),
          path: "/test",
          baseDir: "/test",
          source: "managed",
          commandDispatch: { kind: "tool", toolName: "Bash", argMode: "raw" },
        },
      ];
      const specs = buildSkillCommandSpecs(skills);
      expect(specs[0].description.length).toBeLessThanOrEqual(100);
    });
  });

  describe("describeInstallStep", () => {
    it("describes brew install", () => {
      const step: SkillInstallStep = { id: "1", kind: "brew", formula: "jq" };
      expect(describeInstallStep(step)).toBe("brew install jq");
    });

    it("describes apt install", () => {
      const step: SkillInstallStep = { id: "1", kind: "apt", package: "curl" };
      expect(describeInstallStep(step)).toBe("sudo apt-get install -y curl");
    });

    it("describes npm install", () => {
      const step: SkillInstallStep = { id: "1", kind: "npm", package: "typescript" };
      expect(describeInstallStep(step)).toBe("npm install -g typescript");
    });

    it("describes pip install", () => {
      const step: SkillInstallStep = { id: "1", kind: "pip", package: "requests" };
      expect(describeInstallStep(step)).toBe("pip install requests");
    });

    it("describes script step", () => {
      const step: SkillInstallStep = { id: "1", kind: "script", script: "echo hello" };
      expect(describeInstallStep(step)).toBe("echo hello");
    });

    it("handles missing formula/package gracefully", () => {
      const step: SkillInstallStep = { id: "1", kind: "brew" };
      expect(describeInstallStep(step)).toBe("brew install (unknown)");
    });

    it("handles empty script", () => {
      const step: SkillInstallStep = { id: "1", kind: "script" };
      expect(describeInstallStep(step)).toBe("(empty script)");
    });
  });

  describe("checkSkillDependencies", () => {
    it("returns satisfied when no requirements", () => {
      const skill: Skill = { name: "test", description: "test", path: "/test", baseDir: "/test", source: "managed" };
      const result = checkSkillDependencies(skill);
      expect(result.satisfied).toBe(true);
      expect(result.missing).toEqual([]);
    });

    it("returns satisfied when no bins required", () => {
      const skill: Skill = {
        name: "test",
        description: "test",
        path: "/test",
        baseDir: "/test",
        source: "managed",
        metadata: { requires: {} },
      };
      const result = checkSkillDependencies(skill);
      expect(result.satisfied).toBe(true);
    });

    it("detects missing binaries", () => {
      const skill: Skill = {
        name: "test",
        description: "test",
        path: "/test",
        baseDir: "/test",
        source: "managed",
        metadata: { requires: { bins: ["nonexistent-binary-xyz-12345"] } },
      };
      const result = checkSkillDependencies(skill);
      expect(result.satisfied).toBe(false);
      expect(result.missing).toContain("nonexistent-binary-xyz-12345");
    });
  });
});
