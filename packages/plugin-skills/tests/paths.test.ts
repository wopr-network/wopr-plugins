import { describe, it, expect } from "vitest";
import { WOPR_HOME, SKILLS_DIR, PROJECT_SKILLS_DIR } from "../src/paths.js";
import { homedir } from "node:os";
import { join } from "node:path";

describe("paths", () => {
  it("WOPR_HOME defaults to ~/.wopr", () => {
    if (!process.env.WOPR_HOME) {
      expect(WOPR_HOME).toBe(join(homedir(), ".wopr"));
    }
  });

  it("SKILLS_DIR is under WOPR_HOME", () => {
    expect(SKILLS_DIR).toBe(join(WOPR_HOME, "skills"));
  });

  it("PROJECT_SKILLS_DIR is under current working directory", () => {
    expect(PROJECT_SKILLS_DIR).toBe(join(process.cwd(), ".wopr", "skills"));
  });
});
