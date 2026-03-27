import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WOPRPluginContext } from "@wopr-network/plugin-types";
import { skillCommands } from "../src/commands.js";

// Mock all the functions the command handler calls
vi.mock("../src/skills.js", () => ({
  discoverSkills: vi.fn(() => ({
    skills: [{ name: "test-skill", description: "A test skill" }],
    warnings: [],
  })),
  createSkill: vi.fn(() => ({ name: "new-skill", description: "desc" })),
  removeSkill: vi.fn(),
  installSkillFromGitHub: vi.fn(() => ({ name: "gh-skill" })),
  installSkillFromUrl: vi.fn(() => ({ name: "url-skill" })),
  clearSkillCache: vi.fn(),
  enableSkillAsync: vi.fn(async () => true),
  disableSkillAsync: vi.fn(async () => true),
}));

vi.mock("../src/registries-repository.js", () => ({
  listRegistries: vi.fn(async () => [{ id: "default", url: "https://example.com/registry.json" }]),
  addRegistry: vi.fn(async () => ({ id: "new-reg", url: "https://new.com/registry.json" })),
  removeRegistry: vi.fn(async () => true),
}));

vi.mock("../src/registry-fetcher.js", () => ({
  fetchAllRegistries: vi.fn(async () => ({
    skills: [
      { name: "remote-skill", description: "Remote", source: "github:owner/repo/skill", registry: "default" },
    ],
    errors: [],
  })),
}));

function makeCtx(): WOPRPluginContext {
  return {
    log: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
    // Minimal mock — commands.ts only uses ctx.log
  } as unknown as WOPRPluginContext;
}

describe("skillCommands", () => {
  let ctx: WOPRPluginContext;

  beforeEach(() => {
    ctx = makeCtx();
    vi.clearAllMocks();
  });

  it("exports a single command named 'skill'", () => {
    expect(skillCommands).toHaveLength(1);
    expect(skillCommands[0].name).toBe("skill");
  });

  it("list: shows discovered skills", async () => {
    await skillCommands[0].handler(ctx, ["list"]);
    expect(ctx.log.info).toHaveBeenCalledWith(expect.stringContaining("test-skill"));
  });

  it("registry list: shows registries", async () => {
    await skillCommands[0].handler(ctx, ["registry", "list"]);
    expect(ctx.log.info).toHaveBeenCalledWith(expect.stringContaining("default"));
  });

  it("registry add: adds a registry", async () => {
    const { addRegistry } = await import("../src/registries-repository.js");
    await skillCommands[0].handler(ctx, ["registry", "add", "myrepo", "https://example.com/r.json"]);
    expect(addRegistry).toHaveBeenCalledWith("myrepo", "https://example.com/r.json");
    expect(ctx.log.info).toHaveBeenCalledWith(expect.stringContaining("myrepo"));
  });

  it("registry remove: removes a registry", async () => {
    const { removeRegistry } = await import("../src/registries-repository.js");
    await skillCommands[0].handler(ctx, ["registry", "remove", "myrepo"]);
    expect(removeRegistry).toHaveBeenCalledWith("myrepo");
  });

  it("search: searches registries", async () => {
    await skillCommands[0].handler(ctx, ["search", "remote"]);
    expect(ctx.log.info).toHaveBeenCalledWith(expect.stringContaining("remote-skill"));
  });

  it("install: installs from github source", async () => {
    const { installSkillFromGitHub } = await import("../src/skills.js");
    await skillCommands[0].handler(ctx, ["install", "github:owner/repo/skill"]);
    expect(installSkillFromGitHub).toHaveBeenCalledWith("owner", "repo", "skill", undefined);
  });

  it("install: installs from URL source", async () => {
    const { installSkillFromUrl } = await import("../src/skills.js");
    await skillCommands[0].handler(ctx, ["install", "https://example.com/skill.tar.gz", "my-skill"]);
    expect(installSkillFromUrl).toHaveBeenCalledWith("https://example.com/skill.tar.gz", "my-skill");
  });

  it("create: creates a new skill", async () => {
    const { createSkill } = await import("../src/skills.js");
    await skillCommands[0].handler(ctx, ["create", "new-skill", "A", "new", "skill"]);
    expect(createSkill).toHaveBeenCalledWith("new-skill", "A new skill");
  });

  it("remove: removes a skill", async () => {
    const { removeSkill } = await import("../src/skills.js");
    await skillCommands[0].handler(ctx, ["remove", "old-skill"]);
    expect(removeSkill).toHaveBeenCalledWith("old-skill");
  });

  it("enable: enables a skill", async () => {
    const { enableSkillAsync } = await import("../src/skills.js");
    await skillCommands[0].handler(ctx, ["enable", "my-skill"]);
    expect(enableSkillAsync).toHaveBeenCalledWith("my-skill");
  });

  it("disable: disables a skill", async () => {
    const { disableSkillAsync } = await import("../src/skills.js");
    await skillCommands[0].handler(ctx, ["disable", "my-skill"]);
    expect(disableSkillAsync).toHaveBeenCalledWith("my-skill");
  });

  it("cache clear: clears the cache", async () => {
    const { clearSkillCache } = await import("../src/skills.js");
    await skillCommands[0].handler(ctx, ["cache", "clear"]);
    expect(clearSkillCache).toHaveBeenCalled();
  });

  it("no subcommand: shows usage", async () => {
    await skillCommands[0].handler(ctx, []);
    expect(ctx.log.info).toHaveBeenCalledWith(expect.stringContaining("Usage"));
  });
});

import plugin from "../src/index.js";

describe("plugin export", () => {
  it("has commands array with skill command", () => {
    expect(plugin.commands).toBeDefined();
    expect(plugin.commands).toHaveLength(1);
    expect(plugin.commands![0].name).toBe("skill");
  });
});
