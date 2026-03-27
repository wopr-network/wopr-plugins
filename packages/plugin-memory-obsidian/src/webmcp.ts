// WebMCP types are not yet exported from plugin-types — defined locally
export interface WebMCPParameterDef {
  type: string;
  description: string;
  required?: boolean;
}

export interface WebMCPToolDeclaration {
  name: string;
  description: string;
  parameters: Record<string, WebMCPParameterDef>;
}

export interface WebMCPAuth {
  token?: string;
}

export interface WebMCPToolRegistration extends WebMCPToolDeclaration {
  handler(params: Record<string, unknown>, auth: WebMCPAuth): Promise<unknown>;
}

export interface WebMCPRegistryLike {
  register(tool: WebMCPToolRegistration): void;
  unregister(name: string): void;
}

export const WEBMCP_MANIFEST: WebMCPToolDeclaration[] = [
  {
    name: "memoryObsidian.search",
    description: "Search stored memories in Obsidian vault",
    parameters: {
      query: { type: "string", description: "Search query", required: true },
      limit: { type: "number", description: "Max results", required: false },
    },
  },
  {
    name: "memoryObsidian.list",
    description: "List stored memories, optionally filtered by session",
    parameters: {
      sessionId: { type: "string", description: "Filter by session ID", required: false },
    },
  },
  {
    name: "memoryObsidian.store",
    description: "Manually store a memory",
    parameters: {
      sessionId: { type: "string", description: "Session ID", required: true },
      content: { type: "string", description: "Memory content (markdown)", required: true },
      tags: { type: "string", description: "Comma-separated tags", required: false },
    },
  },
];

export function registerMemoryObsidianTools(registry: WebMCPRegistryLike, apiBase = "/api"): void {
  registry.register({
    ...WEBMCP_MANIFEST[0],
    handler: async (params: Record<string, unknown>, auth: WebMCPAuth) => {
      const res = await fetch(`${apiBase}/plugins/memory-obsidian/search`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(auth.token ? { Authorization: `Bearer ${auth.token}` } : {}),
        },
        body: JSON.stringify(params),
      });
      return res.json();
    },
  });

  registry.register({
    ...WEBMCP_MANIFEST[1],
    handler: async (params: Record<string, unknown>, auth: WebMCPAuth) => {
      const qs = params.sessionId ? `?sessionId=${encodeURIComponent(String(params.sessionId))}` : "";
      const res = await fetch(`${apiBase}/plugins/memory-obsidian/memories${qs}`, {
        headers: auth.token ? { Authorization: `Bearer ${auth.token}` } : {},
      });
      return res.json();
    },
  });

  registry.register({
    ...WEBMCP_MANIFEST[2],
    handler: async (params: Record<string, unknown>, auth: WebMCPAuth) => {
      const tags = params.tags
        ? String(params.tags)
            .split(",")
            .map((t) => t.trim())
        : [];
      const res = await fetch(`${apiBase}/plugins/memory-obsidian/store`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(auth.token ? { Authorization: `Bearer ${auth.token}` } : {}),
        },
        body: JSON.stringify({ ...params, tags }),
      });
      return res.json();
    },
  });
}

export function unregisterMemoryObsidianTools(registry: WebMCPRegistryLike): void {
  for (const decl of WEBMCP_MANIFEST) {
    registry.unregister(decl.name);
  }
}
