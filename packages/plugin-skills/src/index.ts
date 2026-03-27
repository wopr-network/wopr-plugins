import type { WOPRPlugin, WOPRPluginContext } from "@wopr-network/plugin-types";
import { registerSkillsA2ATools, setA2AContext, unregisterSkillsA2ATools } from "./a2a-tools.js";
import { skillCommands } from "./commands.js";
import { setLogger } from "./logger.js";
import { createSkillsRouter } from "./routes.js";
import {
  disableSkillAsync,
  discoverSkills,
  enableSkillAsync,
  formatSkillsXml,
  installSkillFromGitHub,
  installSkillFromUrl,
} from "./skills.js";
import { migrateRegistriesToSQL, migrateSkillsToSQL } from "./skills-migrate.js";
import { initSkillsStorage, resetSkillsStorageInit, setPluginContext } from "./skills-repository.js";
import { skillsPluginSchema } from "./skills-schema.js";

export interface SkillsExtension {
  install: typeof installSkillFromGitHub;
  installFromUrl: typeof installSkillFromUrl;
  enable: typeof enableSkillAsync;
  disable: typeof disableSkillAsync;
  list: typeof discoverSkills;
}

let ctx: WOPRPluginContext | null = null;
const cleanups: Array<() => void> = [];

const plugin: WOPRPlugin = {
  name: "wopr-plugin-skills",
  version: "1.0.0",
  description: "Skill discovery, state management, and REST API",
  manifest: {
    name: "wopr-plugin-skills",
    version: "1.0.0",
    description: "Skill discovery, state management, and REST API",
    capabilities: ["skills:discover", "skills:manage", "skills:state"],
    category: "utility",
    tags: ["skills", "automation", "discovery"],
    icon: "puzzle",
    requires: {},
    lifecycle: {
      shutdownBehavior: "graceful",
    },
  },
  commands: skillCommands,

  async init(context: WOPRPluginContext) {
    ctx = context;

    // Wire up logger
    setLogger(context.log);

    // Wire up storage context
    setPluginContext(context);
    setA2AContext(context);

    // 1. Register schema + init storage
    await context.storage.register(skillsPluginSchema);
    await initSkillsStorage();

    // 2. Run migration (idempotent)
    await migrateSkillsToSQL(context);
    await migrateRegistriesToSQL();

    // 3. Register context provider for skills prompt injection
    context.registerContextProvider({
      name: "skills",
      priority: 10,
      enabled: true,
      async getContext() {
        const { skills, warnings } = discoverSkills();
        for (const w of warnings) {
          context.log.warn(`[skills] ${w.skillPath}: ${w.message}`);
        }
        if (skills.length === 0) return null;
        const skillsXml = formatSkillsXml(skills);
        return {
          content: skillsXml,
          role: "system" as const,
          metadata: { source: "skills", priority: 10, skillCount: skills.length },
        };
      },
    });
    cleanups.push(() => context.unregisterContextProvider("skills"));

    // 4. Register A2A tools
    registerSkillsA2ATools();
    cleanups.push(() => unregisterSkillsA2ATools());

    // 5. Expose REST router as extension for daemon to mount
    const router = createSkillsRouter();
    context.registerExtension("skills:router", router);
    cleanups.push(() => context.unregisterExtension("skills:router"));
    context.registerExtension("skills", {
      install: installSkillFromGitHub,
      installFromUrl: installSkillFromUrl,
      enable: enableSkillAsync,
      disable: disableSkillAsync,
      list: discoverSkills,
    } satisfies SkillsExtension);
    cleanups.push(() => context.unregisterExtension("skills"));

    context.log.info("Skills plugin initialized");
  },

  async shutdown() {
    if (!ctx) return;
    for (const fn of cleanups) {
      fn();
    }
    cleanups.length = 0;
    resetSkillsStorageInit();
    ctx = null;
  },
};

export default plugin;
