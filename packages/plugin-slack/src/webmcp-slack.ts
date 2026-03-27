/**
 * WebMCP Slack Status Tools
 *
 * Registers 4 read-only browser-side WebMCP tools that expose Slack
 * connection state via the WOPR daemon REST API.
 *
 * Pattern: browser WebMCP tool -> fetch(daemon REST API) -> response
 *
 * These tools are only useful when the Slack plugin is loaded on the
 * WOPR instance. They return workspace/channel names, not internal IDs.
 */

// -- Types (minimal subset matching WebMCPRegistry from wopr-plugin-webui) --

export interface ParameterSchema {
  type: string;
  description?: string;
  required?: boolean;
}

export interface AuthContext {
  token?: string;
  [key: string]: unknown;
}

export type WebMCPHandler = (params: Record<string, unknown>, auth: AuthContext) => unknown | Promise<unknown>;

export interface WebMCPTool {
  name: string;
  description: string;
  parameters?: Record<string, ParameterSchema>;
  handler: WebMCPHandler;
}

export interface WebMCPRegistry {
  register(tool: WebMCPTool): void;
  get(name: string): WebMCPTool | undefined;
  list(): string[];
}

// -- Internal helpers --

interface RequestOptions {
  method?: string;
  body?: string;
  headers?: Record<string, string>;
}

async function daemonRequest<T>(
  apiBase: string,
  path: string,
  auth: AuthContext,
  options?: RequestOptions,
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...options?.headers,
  };
  if (auth.token) {
    headers.Authorization = `Bearer ${auth.token}`;
  }
  const res = await fetch(`${apiBase}${path}`, {
    ...options,
    headers,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Request failed" }));
    throw new Error((err as { error?: string }).error || `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

// -- Tool registration --

/**
 * Register all 4 Slack status WebMCP tools on the given registry.
 *
 * @param registry - The WebMCPRegistry instance to register tools on
 * @param apiBase  - Base URL of the WOPR daemon API (e.g. "/api" or "http://localhost:7437/api")
 */
export function registerSlackTools(registry: WebMCPRegistry, apiBase = "/api"): void {
  // 1. getSlackStatus — bot online/offline, connected workspaces, latency
  registry.register({
    name: "getSlackStatus",
    description: "Get Slack bot status: online/offline, connected workspaces, and latency.",
    parameters: {},
    handler: async (_params: Record<string, unknown>, auth: AuthContext) => {
      return daemonRequest(apiBase, `/plugins/${encodeURIComponent("wopr-plugin-slack")}/health`, auth);
    },
  });

  // 2. listWorkspaces — list connected Slack workspaces
  registry.register({
    name: "listWorkspaces",
    description: "List connected Slack workspaces.",
    parameters: {},
    handler: async (_params: Record<string, unknown>, auth: AuthContext) => {
      const health = (await daemonRequest(
        apiBase,
        `/plugins/${encodeURIComponent("wopr-plugin-slack")}/health`,
        auth,
      )) as Record<string, unknown>;
      // Extract workspace-specific data from health response
      return {
        workspaces: health.workspaces ?? health.teams ?? [],
        connected: health.connected ?? health.ok ?? false,
      };
    },
  });

  // 3. listSlackChannels — list channels the bot is in
  registry.register({
    name: "listSlackChannels",
    description: "List Slack channels the bot is currently in.",
    parameters: {
      workspaceId: {
        type: "string",
        description: "Optional workspace identifier to filter channels. Omit for all workspaces.",
        required: false,
      },
    },
    handler: async (params: Record<string, unknown>, auth: AuthContext) => {
      let path = `/plugins/${encodeURIComponent("wopr-plugin-slack")}/channels`;
      if (params.workspaceId) {
        path += `?workspace=${encodeURIComponent(String(params.workspaceId))}`;
      }
      return daemonRequest(apiBase, path, auth);
    },
  });

  // 4. getSlackMessageStats — messages processed, active conversations
  registry.register({
    name: "getSlackMessageStats",
    description: "Get Slack message statistics: messages processed and active conversations.",
    parameters: {},
    handler: async (_params: Record<string, unknown>, auth: AuthContext) => {
      return daemonRequest(apiBase, `/plugins/${encodeURIComponent("wopr-plugin-slack")}/stats`, auth);
    },
  });
}
