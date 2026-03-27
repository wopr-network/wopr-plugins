import type { PluginSchema } from "@wopr-network/plugin-types";
import { z } from "zod";

export const MemoryEntrySchema = z.object({
  /** Stable UUID for this memory. */
  id: z.string(),
  /** Session that produced this memory. */
  sessionId: z.string(),
  /** Full path in the Obsidian vault (e.g. "WOPR/memories/2024-01/abc-def.md"). */
  vaultPath: z.string(),
  /** Extracted memory text stored in the vault note. */
  content: z.string(),
  /** First 200 chars — used for quick display without reading the vault. */
  summary: z.string(),
  /** JSON-encoded string[]. e.g. '["auto","heuristic"]' */
  tags: z.string(),
  /** Unix timestamp (ms) when this memory was created. */
  createdAt: z.number(),
});

export type MemoryEntry = z.infer<typeof MemoryEntrySchema>;

export const memoryObsidianSchema: PluginSchema = {
  namespace: "memory-obsidian",
  version: 1,
  tables: {
    memories: {
      schema: MemoryEntrySchema,
      primaryKey: "id",
      indexes: [{ fields: ["sessionId"] }, { fields: ["createdAt"] }, { fields: ["vaultPath"] }],
    },
  },
};
