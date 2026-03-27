import type { PluginSchema } from "@wopr-network/plugin-types";
import { z } from "zod";

// ---------- skills_state table ----------
export const skillStateSchema = z.object({
  id: z.string(), // Skill name (primary key)
  enabled: z.boolean(), // Whether skill is enabled
  installed: z.boolean(), // Whether skill is installed
  enabledAt: z.string().optional(), // ISO timestamp when enabled
  lastUsedAt: z.string().optional(), // ISO timestamp of last use
  useCount: z.number(), // Number of times skill has been used
});
export type SkillStateRecord = z.infer<typeof skillStateSchema>;

// ---------- skill_registries table ----------
export const registrySchema = z.object({
  id: z.string(), // Registry name (primary key, e.g. "wopr-official")
  url: z.string(), // Registry URL
  addedAt: z.string(), // ISO timestamp
  lastFetchedAt: z.string().optional(), // ISO timestamp of last successful fetch
  lastError: z.string().optional(), // Last fetch error message (null if healthy)
});
export type RegistryRecord = z.infer<typeof registrySchema>;

// ---------- PluginSchema ----------
export const skillsPluginSchema: PluginSchema = {
  namespace: "skills",
  version: 2,
  tables: {
    skills_state: {
      schema: skillStateSchema,
      primaryKey: "id",
      indexes: [{ fields: ["enabled"] }, { fields: ["lastUsedAt"] }],
    },
    skill_registries: {
      schema: registrySchema,
      primaryKey: "id",
      indexes: [],
    },
  },
};
