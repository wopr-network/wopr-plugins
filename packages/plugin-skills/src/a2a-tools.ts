import type { A2AServerConfig, WOPRPluginContext } from "@wopr-network/plugin-types";
import { logger } from "./logger.js";
import {
  disableSkillAsync,
  discoverSkills,
  enableSkillAsync,
  getSkillByName,
  readAllSkillStatesAsync,
} from "./skills.js";

let pluginCtx: WOPRPluginContext | null = null;

export function setA2AContext(context: WOPRPluginContext): void {
  pluginCtx = context;
}

export function registerSkillsA2ATools(): void {
  if (!pluginCtx?.registerA2AServer) {
    logger.debug("[skills] registerA2AServer not available in this WOPR version, skipping A2A tool registration");
    return;
  }

  const config: A2AServerConfig = {
    name: "wopr-plugin-skills",
    version: "1.0.0",
    tools: [
      {
        name: "skills.list",
        description: "List all discovered skills and their enabled/disabled state",
        inputSchema: {
          type: "object",
          properties: {
            source: {
              type: "string",
              description: "Filter by source: managed, workspace, bundled, extra",
            },
          },
          additionalProperties: false,
        },
        handler: async (args) => {
          const { skills, warnings } = discoverSkills();
          const states = await readAllSkillStatesAsync();
          const source = args.source as string | undefined;
          const filtered = source ? skills.filter((s) => s.source === source) : skills;
          const result = {
            skills: filtered.map((s) => ({
              name: s.name,
              description: s.description,
              source: s.source,
              enabled: states[s.name]?.enabled !== false,
            })),
            warnings: warnings.length > 0 ? warnings : undefined,
          };
          return {
            content: [{ type: "text" as const, text: JSON.stringify(result) }],
          };
        },
      },
      {
        name: "skills.enable",
        description: "Enable a skill by name",
        inputSchema: {
          type: "object",
          properties: {
            name: { type: "string", description: "Skill name to enable" },
          },
          required: ["name"],
          additionalProperties: false,
        },
        handler: async (args) => {
          const found = await enableSkillAsync(args.name as string);
          const result = found ? { enabled: true, name: args.name } : { error: "Skill not found" };
          return {
            content: [{ type: "text" as const, text: JSON.stringify(result) }],
          };
        },
      },
      {
        name: "skills.disable",
        description: "Disable a skill by name",
        inputSchema: {
          type: "object",
          properties: {
            name: { type: "string", description: "Skill name to disable" },
          },
          required: ["name"],
          additionalProperties: false,
        },
        handler: async (args) => {
          const found = await disableSkillAsync(args.name as string);
          const result = found ? { disabled: true, name: args.name } : { error: "Skill not found" };
          return {
            content: [{ type: "text" as const, text: JSON.stringify(result) }],
          };
        },
      },
      {
        name: "skills.info",
        description: "Get detailed info about a specific skill",
        inputSchema: {
          type: "object",
          properties: {
            name: { type: "string", description: "Skill name to look up" },
          },
          required: ["name"],
          additionalProperties: false,
        },
        handler: async (args) => {
          const skill = getSkillByName(args.name as string);
          if (!skill) {
            return {
              content: [{ type: "text" as const, text: JSON.stringify({ error: "Skill not found" }) }],
            };
          }
          const states = await readAllSkillStatesAsync();
          const result = {
            name: skill.name,
            description: skill.description,
            source: skill.source,
            path: skill.path,
            baseDir: skill.baseDir,
            enabled: states[skill.name]?.enabled !== false,
            metadata: skill.metadata ?? null,
            allowedTools: skill.allowedTools ?? null,
            commandDispatch: skill.commandDispatch ?? null,
          };
          return {
            content: [{ type: "text" as const, text: JSON.stringify(result) }],
          };
        },
      },
    ],
  };

  pluginCtx.registerA2AServer(config);
  logger.debug("[skills] A2A tools registered");
}

export function unregisterSkillsA2ATools(): void {
  // A2A server lifecycle is managed by WOPR core when the plugin shuts down
  logger.debug("[skills] A2A tools unregistered");
}
