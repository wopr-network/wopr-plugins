/**
 * CLI commands for `wopr skill` — registered via plugin.commands.
 *
 * This replaces the former wopr core src/commands/skill.ts.
 * All functions called here already exist in this plugin.
 */

import type { PluginCommand, WOPRPluginContext } from "@wopr-network/plugin-types";
import { addRegistry, listRegistries, removeRegistry } from "./registries-repository.js";
import { fetchAllRegistries } from "./registry-fetcher.js";
import {
  clearSkillCache,
  createSkill,
  disableSkillAsync,
  discoverSkills,
  enableSkillAsync,
  installSkillFromGitHub,
  installSkillFromUrl,
  removeSkill,
} from "./skills.js";

const USAGE = `Usage: wopr skill <subcommand>

Subcommands:
  list                          List installed skills
  search <query>                Search registries for skills
  install <source> [name]       Install a skill (github:owner/repo/path or URL)
  create <name> [description]   Create a new local skill
  remove <name>                 Remove an installed skill
  enable <name>                 Enable a skill
  disable <name>                Disable a skill
  cache clear                   Clear the skill cache
  registry list                 List skill registries
  registry add <name> <url>     Add a skill registry
  registry remove <name>        Remove a skill registry`;

async function cmdList(ctx: WOPRPluginContext): Promise<void> {
  const { skills } = discoverSkills();
  if (skills.length === 0) {
    ctx.log.info("No skills installed.");
  } else {
    ctx.log.info("Skills:");
    for (const s of skills) ctx.log.info(`  ${s.name} - ${s.description ?? "No description"}`);
  }
}

async function cmdSearch(ctx: WOPRPluginContext, rest: string[]): Promise<void> {
  if (!rest[0]) {
    ctx.log.error("Usage: wopr skill search <query>");
    return;
  }
  const query = rest.join(" ");
  const registries = await listRegistries();
  const { skills } = await fetchAllRegistries(registries);
  const results = skills.filter(
    (s) =>
      s.name.toLowerCase().includes(query.toLowerCase()) ||
      (s.description ?? "").toLowerCase().includes(query.toLowerCase()),
  );
  if (results.length === 0) {
    ctx.log.info(`No skills found matching "${query}"`);
  } else {
    ctx.log.info(`Found ${results.length} skill(s):`);
    for (const r of results) {
      ctx.log.info(`  ${r.name} (${r.registry})`);
      ctx.log.info(`    ${r.description || "No description"}`);
      ctx.log.info(`    wopr skill install ${r.source}`);
    }
  }
}

function cmdInstall(ctx: WOPRPluginContext, rest: string[]): void {
  if (!rest[0]) {
    ctx.log.error("Usage: wopr skill install <source> [name]");
    return;
  }
  const source = rest[0];
  const name = rest[1];
  ctx.log.info("Installing...");
  try {
    if (source.startsWith("github:")) {
      const parts = source.replace("github:", "").split("/");
      const [owner, repo, ...pathParts] = parts;
      const skillPath = pathParts.join("/");
      installSkillFromGitHub(owner, repo, skillPath, name);
    } else {
      installSkillFromUrl(source, name);
    }
    ctx.log.info(`Installed: ${name || source}`);
  } catch (err: unknown) {
    ctx.log.error(`Failed to install skill: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function cmdCreate(ctx: WOPRPluginContext, rest: string[]): void {
  if (!rest[0]) {
    ctx.log.error("Usage: wopr skill create <name> [description]");
    return;
  }
  try {
    const description = rest.slice(1).join(" ") || undefined;
    createSkill(rest[0], description);
    ctx.log.info(`Created skill: ${rest[0]}`);
  } catch (err: unknown) {
    ctx.log.error(`Failed to create skill: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function cmdRemove(ctx: WOPRPluginContext, rest: string[]): void {
  if (!rest[0]) {
    ctx.log.error("Usage: wopr skill remove <name>");
    return;
  }
  try {
    removeSkill(rest[0]);
    ctx.log.info(`Removed: ${rest[0]}`);
  } catch (err: unknown) {
    ctx.log.error(`Failed to remove skill: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function cmdEnable(ctx: WOPRPluginContext, rest: string[]): Promise<void> {
  if (!rest[0]) {
    ctx.log.error("Usage: wopr skill enable <name>");
    return;
  }
  const found = await enableSkillAsync(rest[0]);
  if (found) {
    ctx.log.info(`Enabled: ${rest[0]}`);
  } else {
    ctx.log.error(`Skill not found: ${rest[0]}`);
  }
}

async function cmdDisable(ctx: WOPRPluginContext, rest: string[]): Promise<void> {
  if (!rest[0]) {
    ctx.log.error("Usage: wopr skill disable <name>");
    return;
  }
  const found = await disableSkillAsync(rest[0]);
  if (found) {
    ctx.log.info(`Disabled: ${rest[0]}`);
  } else {
    ctx.log.error(`Skill not found: ${rest[0]}`);
  }
}

async function handleSkillCommand(ctx: WOPRPluginContext, args: string[]): Promise<void> {
  const subcommand = args[0];
  const rest = args.slice(1);

  switch (subcommand) {
    case "list":
      await cmdList(ctx);
      break;
    case "search":
      await cmdSearch(ctx, rest);
      break;
    case "install":
      cmdInstall(ctx, rest);
      break;
    case "create":
      cmdCreate(ctx, rest);
      break;
    case "remove":
      cmdRemove(ctx, rest);
      break;
    case "enable":
      await cmdEnable(ctx, rest);
      break;
    case "disable":
      await cmdDisable(ctx, rest);
      break;
    case "cache":
      if (rest[0] === "clear") {
        clearSkillCache();
        ctx.log.info("Cache cleared");
      } else {
        ctx.log.info(USAGE);
      }
      break;
    case "registry":
      await handleRegistry(ctx, rest);
      break;
    default:
      ctx.log.info(USAGE);
  }
}

async function handleRegistry(ctx: WOPRPluginContext, args: string[]): Promise<void> {
  const registryCmd = args[0];

  switch (registryCmd) {
    case "list": {
      const registries = await listRegistries();
      if (registries.length === 0) {
        ctx.log.info("No registries. Add: wopr skill registry add <name> <url>");
      } else {
        ctx.log.info("Registries:");
        for (const r of registries) ctx.log.info(`  ${r.id}: ${r.url}`);
      }
      break;
    }

    case "add": {
      if (!args[1] || !args[2]) {
        ctx.log.error("Usage: wopr skill registry add <name> <url>");
        return;
      }
      await addRegistry(args[1], args[2]);
      ctx.log.info(`Added registry: ${args[1]}`);
      break;
    }

    case "remove": {
      if (!args[1]) {
        ctx.log.error("Usage: wopr skill registry remove <name>");
        return;
      }
      const removed = await removeRegistry(args[1]);
      if (removed) {
        ctx.log.info(`Removed registry: ${args[1]}`);
      } else {
        ctx.log.error(`Registry not found: ${args[1]}`);
      }
      break;
    }

    default:
      ctx.log.info(USAGE);
  }
}

export const skillCommands: PluginCommand[] = [
  {
    name: "skill",
    description: "Manage skills: list, search, install, create, remove, enable, disable",
    usage: USAGE,
    handler: handleSkillCommand,
  },
];
