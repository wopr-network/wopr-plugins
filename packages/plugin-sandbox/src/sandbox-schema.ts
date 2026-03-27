/**
 * Sandbox storage schema - SQL-based container registry
 */

import type { PluginSchema } from "@wopr-network/plugin-types";
import { z } from "zod";

/**
 * Schema for sandbox registry entries
 * Tracks Docker container state across restarts
 */
export const sandboxRegistryRecordSchema = z.object({
  id: z.string(), // containerName as primary key
  containerName: z.string(),
  sessionKey: z.string(),
  createdAtMs: z.number(),
  lastUsedAtMs: z.number(),
  image: z.string(),
  configHash: z.string().optional(),
});

export type SandboxRegistryRecord = z.infer<typeof sandboxRegistryRecordSchema>;

/**
 * Plugin schema definition for sandbox storage
 * Namespace: "sandbox" -> table: sandbox_registry
 */
export const sandboxPluginSchema: PluginSchema = {
  namespace: "sandbox",
  version: 1,
  tables: {
    sandbox_registry: {
      schema: sandboxRegistryRecordSchema,
      primaryKey: "id",
      indexes: [{ fields: ["sessionKey"] }, { fields: ["containerName"] }, { fields: ["lastUsedAtMs"] }],
    },
  },
};
