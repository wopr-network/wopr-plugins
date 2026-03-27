import { randomUUID } from "node:crypto";
import type {
  ConfigSchema,
  MemorySearchEvent,
  MessageInfo,
  PluginManifest,
  WOPRPlugin,
  WOPRPluginContext,
} from "@wopr-network/plugin-types";
import { buildA2ATools } from "./a2a-tools.js";
import { extractFullExchange, extractHeuristic } from "./extractor.js";
import {
  deleteMemory,
  findAll,
  findBySession,
  findByVaultPath,
  initStorage,
  saveMemory,
} from "./memory-obsidian-repository.js";
import type { MemoryEntry } from "./memory-obsidian-schema.js";
import type { MemoryObsidianConfig, MemoryObsidianExtension, VaultClient } from "./types.js";
import { registerMemoryObsidianTools, unregisterMemoryObsidianTools, WEBMCP_MANIFEST } from "./webmcp.js";

export { WEBMCP_MANIFEST, registerMemoryObsidianTools, unregisterMemoryObsidianTools };

// Module-level state — null until init()
let ctx: WOPRPluginContext | null = null;
const cleanups: Array<() => void> = [];

const configSchema: ConfigSchema = {
  title: "Memory (Obsidian)",
  description: "Auto-store and recall conversation memories in your Obsidian vault",
  fields: [
    {
      name: "autoStore",
      type: "select",
      label: "Auto-store memories",
      options: [
        { value: "always", label: "Always — store every exchange" },
        { value: "heuristic", label: "Smart — store exchanges with memorable content (recommended)" },
        { value: "never", label: "Disabled — manual storage only" },
      ],
      default: "heuristic",
      setupFlow: "none",
    },
    {
      name: "extractionMode",
      type: "select",
      label: "Extraction mode",
      options: [
        { value: "heuristic", label: "Heuristic — extract key facts and preferences (recommended)" },
        { value: "full-exchange", label: "Full exchange — store the whole Q&A verbatim" },
      ],
      default: "heuristic",
      setupFlow: "none",
    },
    {
      name: "autoRecall",
      type: "select",
      label: "Auto-recall",
      options: [
        { value: "always", label: "Always — inject relevant memories before every message" },
        { value: "on-demand", label: "On demand — A2A tools only" },
        { value: "never", label: "Disabled" },
      ],
      default: "always",
      setupFlow: "none",
    },
    {
      name: "maxRecallNotes",
      type: "number",
      label: "Max memories injected per message",
      default: 5,
      setupFlow: "none",
    },
    {
      name: "vaultFolder",
      type: "text",
      label: "Vault folder for memories",
      placeholder: "WOPR/memories",
      default: "WOPR/memories",
      setupFlow: "none",
    },
    {
      name: "minExchangeLength",
      type: "number",
      label: "Min exchange length to trigger auto-store (chars)",
      default: 300,
      setupFlow: "none",
    },
  ],
};

const manifest: PluginManifest = {
  name: "@wopr-network/wopr-plugin-memory-obsidian",
  version: "1.0.0",
  description: "Auto-store and recall conversation memories in your Obsidian vault",
  author: "wopr-network",
  license: "MIT",
  repository: "https://github.com/wopr-network/wopr-plugin-memory-obsidian",
  homepage: "https://github.com/wopr-network/wopr-plugin-memory-obsidian#readme",

  capabilities: ["memory"],
  category: "utilities",
  tags: ["memory", "obsidian", "recall", "knowledge-base", "pkm", "auto-store"],
  icon: "🧠",

  requires: {
    config: [],
    storage: { persistent: true, estimatedSize: "10MB" },
  },

  dependencies: ["@wopr-network/wopr-plugin-obsidian"],

  configSchema,

  lifecycle: {
    hotReload: false,
    shutdownBehavior: "graceful",
    shutdownTimeoutMs: 10_000,
  },

  minCoreVersion: "1.0.0",
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function getCtx(): WOPRPluginContext {
  if (!ctx) throw new Error("wopr-plugin-memory-obsidian not initialized");
  return ctx;
}

function getObsidian(): VaultClient | undefined {
  return getCtx().getExtension("obsidian") as VaultClient | undefined;
}

function vaultPath(cfg: MemoryObsidianConfig, sessionId: string, id: string): string {
  const date = new Date();
  const month = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  const folder = cfg.vaultFolder ?? "WOPR/memories";
  return `${folder}/${month}/${sessionId.slice(0, 8)}-${id.slice(0, 8)}.md`;
}

function buildNoteContent(id: string, sessionId: string, tags: string[], createdAt: Date, content: string): string {
  const frontmatter = [
    "---",
    `id: ${id}`,
    `session: ${sessionId}`,
    `tags: [${tags.map((t) => `"${t}"`).join(", ")}]`,
    `created: ${createdAt.toISOString()}`,
    "---",
    "",
  ].join("\n");
  return `${frontmatter}\n# Memory\n\n${content}`;
}

// ── Plugin ────────────────────────────────────────────────────────────────────

const plugin: WOPRPlugin = {
  name: "@wopr-network/wopr-plugin-memory-obsidian",
  version: "1.0.0",
  description: manifest.description,
  manifest,

  async init(context: WOPRPluginContext) {
    ctx = context;

    ctx.registerConfigSchema("wopr-plugin-memory-obsidian", configSchema);
    await initStorage(ctx.storage);

    const obsidian = getObsidian();
    if (!obsidian) {
      ctx.log.warn("wopr-plugin-obsidian extension not found — vault I/O will be unavailable until it loads");
    }

    // ── Context provider: auto-recall ─────────────────────────────────────────
    ctx.registerContextProvider({
      name: "memory-obsidian",
      priority: 20,
      enabled: true,
      async getContext(_session: string, message: MessageInfo) {
        const cfg = getCtx().getConfig<MemoryObsidianConfig>();
        if (cfg.autoRecall !== "always") return null;

        const vault = getObsidian();
        if (!vault?.isConnected()) return null;

        const query = message.content;
        if (!query?.trim()) return null;

        try {
          const limit = cfg.maxRecallNotes ?? 5;
          const results = await vault.search(query, limit);
          const top = results.slice(0, limit);
          if (!top.length) return null;

          const notes = await Promise.all(
            top.map(async (r) => {
              try {
                const note = await vault.read(r.filename);
                return `### ${r.filename}\n${note.content.slice(0, 1500)}`;
              } catch {
                return null;
              }
            }),
          );

          const valid = notes.filter((n): n is string => n !== null);
          if (!valid.length) return null;

          return {
            content: `## Relevant memories from your vault:\n\n${valid.join("\n\n---\n\n")}`,
            role: "system" as const,
            metadata: { source: "memory-obsidian", priority: 20, memoryCount: valid.length },
          };
        } catch (error: unknown) {
          ctx?.log.warn(`Memory recall failed: ${error instanceof Error ? error.message : String(error)}`);
          return null;
        }
      },
    });

    // ── Event: session:afterInject — auto-store ───────────────────────────────
    const afterUnsub = ctx.events.on("session:afterInject", async (payload: unknown) => {
      const { session, message, response } = payload as { session: string; message: string; response: string };
      const cfg = getCtx().getConfig<MemoryObsidianConfig>();

      if (cfg.autoStore === "never") return;

      const vault = getObsidian();
      if (!vault?.isConnected()) return;

      try {
        const mode = cfg.extractionMode ?? "heuristic";
        const extracted =
          cfg.autoStore === "always" || mode === "full-exchange"
            ? extractFullExchange(message, response)
            : extractHeuristic(message, response, cfg.minExchangeLength ?? 300);

        if (!extracted) return;

        const id = randomUUID();
        const now = new Date();
        const path = vaultPath(cfg, session, id);

        await vault.write(path, buildNoteContent(id, session, extracted.tags, now, extracted.content));

        await saveMemory({
          id,
          sessionId: session,
          vaultPath: path,
          content: extracted.content,
          summary: extracted.summary,
          tags: JSON.stringify(extracted.tags),
          createdAt: now.getTime(),
        });

        ctx?.log.debug(`Memory stored: ${path}`);
      } catch (error: unknown) {
        ctx?.log.warn(`Auto-store failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
    cleanups.push(afterUnsub as () => void);

    // ── Event: memory:search — augment with vault memories ────────────────────
    const memUnsub = ctx.events.on("memory:search", async (payload: MemorySearchEvent) => {
      const vault = getObsidian();
      if (!vault?.isConnected()) return;
      try {
        const results = await vault.search(payload.query, 5);
        if (!payload.results) return;
        for (const r of results.slice(0, 3)) {
          (payload.results as Array<{ content: string; source: string; score: number }>).push({
            content: r.matches[0]?.context ?? r.filename,
            source: `memory-obsidian:${r.filename}`,
            score: r.score,
          });
        }
      } catch {
        // non-fatal — search continues without vault results
      }
    });
    cleanups.push(memUnsub as () => void);

    // ── Extension: typed API for other plugins ────────────────────────────────
    const extension: MemoryObsidianExtension = {
      async store(sessionId, content, tags = []) {
        const vault = getObsidian();
        if (!vault) throw new Error("obsidian extension not available");

        const id = randomUUID();
        const now = new Date();
        const cfg = getCtx().getConfig<MemoryObsidianConfig>();
        const path = vaultPath(cfg, sessionId, id);
        const allTags = ["manual", ...tags];

        await vault.write(path, buildNoteContent(id, sessionId, allTags, now, content));

        const entry: MemoryEntry = {
          id,
          sessionId,
          vaultPath: path,
          content,
          summary: content.slice(0, 200),
          tags: JSON.stringify(allTags),
          createdAt: now.getTime(),
        };
        return saveMemory(entry);
      },

      async search(query, limit = 10) {
        const vault = getObsidian();
        if (!vault?.isConnected()) {
          // Fall back to full local index (no relevance ranking)
          return findAll();
        }

        const results = await vault.search(query, limit);
        const entries: MemoryEntry[] = [];

        for (const r of results.slice(0, limit)) {
          // Try to find in local index by vault path first (fast path)
          const local = await findByVaultPath(r.filename);
          if (local) {
            entries.push(local);
            continue;
          }
          // Synthesize an ephemeral entry from the vault note
          try {
            const note = await vault.read(r.filename);
            entries.push({
              id: r.filename,
              sessionId: "",
              vaultPath: r.filename,
              content: note.content.slice(0, 2000),
              summary: note.content.slice(0, 200),
              tags: "[]",
              createdAt: 0,
            });
          } catch {
            // skip unreadable note
          }
        }

        return entries;
      },

      async recall(sessionId, query, limit = 5) {
        const all = await findBySession(sessionId);
        const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
        return all
          .filter((e) => terms.some((t) => e.content.toLowerCase().includes(t) || e.summary.toLowerCase().includes(t)))
          .slice(0, limit);
      },

      async forget(id) {
        return deleteMemory(id);
      },

      async list(sessionId) {
        if (sessionId) return findBySession(sessionId);
        return findAll();
      },
    };
    ctx.registerExtension("memory-obsidian", extension);

    // ── A2A tools ─────────────────────────────────────────────────────────────
    if (ctx.registerA2AServer) {
      ctx.registerA2AServer({
        name: "memory-obsidian",
        version: "1.0",
        tools: buildA2ATools(extension),
      });
    }

    ctx.log.info("wopr-plugin-memory-obsidian initialized");
  },

  async shutdown() {
    for (const cleanup of cleanups) {
      try {
        cleanup();
      } catch {
        /* ignore */
      }
    }
    cleanups.length = 0;

    ctx?.unregisterConfigSchema("wopr-plugin-memory-obsidian");
    ctx?.unregisterContextProvider("memory-obsidian");
    ctx?.unregisterExtension("memory-obsidian");

    ctx = null;
  },
};

export default plugin;
