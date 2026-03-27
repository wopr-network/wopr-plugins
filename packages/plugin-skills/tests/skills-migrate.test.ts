import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const testDir = join(tmpdir(), "wopr-migrate-reg-test");

vi.mock("../src/paths.js", () => ({
  WOPR_HOME: testDir,
  SKILLS_DIR: join(testDir, "skills"),
  PROJECT_SKILLS_DIR: join(testDir, ".wopr", "skills"),
  REGISTRIES_FILE: join(testDir, "registries.json"),
}));

vi.mock("../src/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../src/registries-repository.js", () => ({
  addRegistry: vi.fn(),
}));

vi.mock("../src/skills-repository.js", () => ({
  getPluginContext: vi.fn(),
  initSkillsStorage: vi.fn(),
  setPluginContext: vi.fn(),
}));

const { addRegistry } = await import("../src/registries-repository.js");

describe("migrateRegistriesToSQL", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("skips when no registries.json exists", async () => {
    const { migrateRegistriesToSQL } = await import("../src/skills-migrate.js");
    await migrateRegistriesToSQL();
    expect(addRegistry).not.toHaveBeenCalled();
  });

  it("migrates registries and backs up file", async () => {
    writeFileSync(
      join(testDir, "registries.json"),
      JSON.stringify([{ name: "official", url: "https://example.com/r.json" }]),
    );
    vi.mocked(addRegistry).mockResolvedValue({
      id: "official",
      url: "https://example.com/r.json",
      addedAt: "2026-01-01T00:00:00Z",
    });

    const { migrateRegistriesToSQL } = await import("../src/skills-migrate.js");
    await migrateRegistriesToSQL();

    expect(addRegistry).toHaveBeenCalledWith("official", "https://example.com/r.json");
    expect(existsSync(join(testDir, "registries.json"))).toBe(false);
    expect(existsSync(join(testDir, "registries.json.backup"))).toBe(true);
  });

  it("skips duplicates without failing", async () => {
    writeFileSync(
      join(testDir, "registries.json"),
      JSON.stringify([{ name: "dup", url: "https://example.com" }]),
    );
    vi.mocked(addRegistry).mockRejectedValue(new Error('Registry "dup" already exists'));

    const { migrateRegistriesToSQL } = await import("../src/skills-migrate.js");
    await expect(migrateRegistriesToSQL()).resolves.not.toThrow();
    // File should still be backed up even if all were duplicates
    expect(existsSync(join(testDir, "registries.json.backup"))).toBe(true);
  });
});
