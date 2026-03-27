import type { WOPRPlugin, WOPRPluginContext } from "@wopr-network/plugin-types";

export type { WOPRPlugin, WOPRPluginContext };

export interface MemoryObsidianConfig {
  autoStore: "always" | "heuristic" | "never";
  extractionMode: "full-exchange" | "heuristic";
  autoRecall: "always" | "on-demand" | "never";
  maxRecallNotes: number;
  vaultFolder: string;
  minExchangeLength: number;
}

// Matches the ObsidianExtension interface from wopr-plugin-obsidian at runtime.
// Defined locally to avoid a hard import dependency on the other plugin package.
export interface VaultSearchResult {
  filename: string;
  score: number;
  matches: Array<{ match?: { start: number; end: number }; context?: string }>;
}

export interface VaultNote {
  path: string;
  content: string;
}

export interface VaultClient {
  search(query: string, limit?: number): Promise<VaultSearchResult[]>;
  read(path: string): Promise<VaultNote>;
  write(path: string, content: string): Promise<void>;
  append(path: string, content: string): Promise<void>;
  list(folder?: string): Promise<string[]>;
  isConnected(): boolean;
}

// Extension API exposed to other plugins via ctx.registerExtension("memory-obsidian", ...)
export interface MemoryObsidianExtension {
  /** Manually store a memory in the vault and local index. */
  store(
    sessionId: string,
    content: string,
    tags?: string[],
  ): Promise<import("./memory-obsidian-schema.js").MemoryEntry>;
  /** Search memories by query string. Falls back to local index if vault is unavailable. */
  search(query: string, limit?: number): Promise<import("./memory-obsidian-schema.js").MemoryEntry[]>;
  /** Recall memories relevant to a query, scoped to a session. */
  recall(
    sessionId: string,
    query: string,
    limit?: number,
  ): Promise<import("./memory-obsidian-schema.js").MemoryEntry[]>;
  /** Remove a memory from the local index (vault note is not deleted). */
  forget(id: string): Promise<boolean>;
  /** List all memories, optionally filtered by session. */
  list(sessionId?: string): Promise<import("./memory-obsidian-schema.js").MemoryEntry[]>;
}
