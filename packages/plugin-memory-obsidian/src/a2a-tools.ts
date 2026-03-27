import type { MemoryObsidianExtension } from "./types.js";

type ToolResult = { content: [{ type: "text"; text: string }]; isError?: boolean };

function ok(data: unknown): ToolResult {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

function err(error: unknown): ToolResult {
  const message = error instanceof Error ? error.message : String(error);
  return { content: [{ type: "text" as const, text: message }], isError: true };
}

export function buildA2ATools(ext: MemoryObsidianExtension) {
  return [
    {
      name: "memory.store",
      description: "Manually store a memory in the Obsidian vault",
      inputSchema: {
        type: "object",
        properties: {
          sessionId: { type: "string", description: "Session ID to associate this memory with" },
          content: { type: "string", description: "The memory content to store (markdown)" },
          tags: {
            type: "array",
            items: { type: "string" },
            description: "Optional tags (e.g. ['preference', 'fact'])",
          },
        },
        required: ["sessionId", "content"],
      },
      async handler(args: unknown) {
        const { sessionId, content, tags } = args as { sessionId: string; content: string; tags?: string[] };
        try {
          const entry = await ext.store(sessionId, content, tags);
          return ok({ id: entry.id, vaultPath: entry.vaultPath, summary: entry.summary });
        } catch (error: unknown) {
          return err(error);
        }
      },
    },
    {
      name: "memory.search",
      description: "Search memories in the Obsidian vault by keyword or phrase",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query" },
          limit: { type: "number", description: "Max results (default 10)" },
        },
        required: ["query"],
      },
      async handler(args: unknown) {
        const { query, limit = 10 } = args as { query: string; limit?: number };
        try {
          const entries = await ext.search(query, limit);
          return ok(
            entries.map((e) => ({ id: e.id, vaultPath: e.vaultPath, summary: e.summary, tags: JSON.parse(e.tags) })),
          );
        } catch (error: unknown) {
          return err(error);
        }
      },
    },
    {
      name: "memory.recall",
      description: "Recall memories relevant to a query, scoped to a session",
      inputSchema: {
        type: "object",
        properties: {
          sessionId: { type: "string", description: "Session ID to scope the recall" },
          query: { type: "string", description: "What to recall" },
          limit: { type: "number", description: "Max memories returned (default 5)" },
        },
        required: ["sessionId", "query"],
      },
      async handler(args: unknown) {
        const { sessionId, query, limit = 5 } = args as { sessionId: string; query: string; limit?: number };
        try {
          const entries = await ext.recall(sessionId, query, limit);
          return ok(entries.map((e) => ({ id: e.id, vaultPath: e.vaultPath, content: e.content.slice(0, 500) })));
        } catch (error: unknown) {
          return err(error);
        }
      },
    },
    {
      name: "memory.forget",
      description: "Remove a memory from the index by ID (vault note is preserved)",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Memory ID to remove" },
        },
        required: ["id"],
      },
      async handler(args: unknown) {
        const { id } = args as { id: string };
        try {
          const deleted = await ext.forget(id);
          return ok({ deleted, id });
        } catch (error: unknown) {
          return err(error);
        }
      },
    },
    {
      name: "memory.list",
      description: "List stored memories, optionally filtered by session",
      inputSchema: {
        type: "object",
        properties: {
          sessionId: { type: "string", description: "Filter by session ID (omit for all memories)" },
        },
        required: [],
      },
      async handler(args: unknown) {
        const { sessionId } = (args ?? {}) as { sessionId?: string };
        try {
          const entries = await ext.list(sessionId);
          return ok(
            entries.map((e) => ({
              id: e.id,
              sessionId: e.sessionId,
              vaultPath: e.vaultPath,
              summary: e.summary,
              tags: JSON.parse(e.tags),
              createdAt: new Date(e.createdAt).toISOString(),
            })),
          );
        } catch (error: unknown) {
          return err(error);
        }
      },
    },
  ];
}
