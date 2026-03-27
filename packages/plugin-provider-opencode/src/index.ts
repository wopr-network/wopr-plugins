/**
 * WOPR Plugin: OpenCode Provider
 *
 * Provides OpenCode AI access via the OpenCode SDK.
 * Supports A2A tools via MCP server configuration.
 * Install: wopr plugin install wopr-plugin-provider-opencode
 */

import type { OpencodeClientInstance } from "@opencode-ai/sdk";
import winston from "winston";
import type { A2AServerConfig, ConfigSchema, PluginManifest, WOPRPlugin, WOPRPluginContext } from "./types.js";

type OpencodeModule = {
  createOpencodeClient: typeof import("@opencode-ai/sdk").createOpencodeClient;
};

// ---------------------------------------------------------------------------
// Provider-specific interfaces (not part of plugin-types)
// ---------------------------------------------------------------------------

interface ModelQueryOptions {
  prompt: string;
  systemPrompt?: string;
  resume?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  images?: string[];
  tools?: string[];
  a2aServers?: Record<string, A2AServerConfig>;
  allowedTools?: string[];
  providerOptions?: Record<string, unknown>;
}

interface ModelClient {
  query(options: ModelQueryOptions): AsyncGenerator<unknown>;
  listModels(): Promise<string[]>;
  healthCheck(): Promise<boolean>;
}

interface ModelProvider {
  id: string;
  name: string;
  description: string;
  defaultModel: string;
  supportedModels: string[];
  validateCredentials(credentials: string): Promise<boolean>;
  createClient(credential: string, options?: Record<string, unknown>): Promise<ModelClient>;
  getCredentialType(): "api-key" | "oauth" | "custom";
}

// ---------------------------------------------------------------------------
// Logger
// ---------------------------------------------------------------------------

const logger = winston.createLogger({
  level: "info",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json(),
  ),
  defaultMeta: { service: "wopr-plugin-provider-opencode" },
  transports: [new winston.transports.Console({ level: "warn" })],
});

let ctx: WOPRPluginContext | null = null;
const cleanups: Array<() => void> = [];

// ---------------------------------------------------------------------------
// OpenCode SDK lazy-loader
// ---------------------------------------------------------------------------

let OpencodeSDK: OpencodeModule | undefined;

async function loadOpencodeSDK() {
  if (!OpencodeSDK) {
    try {
      const opencode = await import("@opencode-ai/sdk");
      OpencodeSDK = opencode;
    } catch (_error: unknown) {
      throw new Error("OpenCode SDK not installed. Run: npm install @opencode-ai/sdk");
    }
  }
  return OpencodeSDK;
}

// ---------------------------------------------------------------------------
// Config schema
// ---------------------------------------------------------------------------

const configSchema: ConfigSchema = {
  title: "OpenCode",
  description: "Configure OpenCode server connection",
  fields: [
    {
      name: "serverUrl",
      type: "text",
      label: "Server URL",
      placeholder: "http://localhost:4096",
      default: "http://localhost:4096",
      required: true,
      description: "OpenCode server URL (must be running)",
    },
    {
      name: "model",
      type: "select",
      label: "Default Model",
      options: [
        { value: "claude-3-5-sonnet", label: "Claude 3.5 Sonnet" },
        { value: "claude-3-5-haiku", label: "Claude 3.5 Haiku" },
        { value: "gpt-4o", label: "GPT-4o" },
        { value: "gpt-4o-mini", label: "GPT-4o Mini" },
      ],
      default: "claude-3-5-sonnet",
      description: "Default model to use for new sessions",
    },
  ],
};

// ---------------------------------------------------------------------------
// Provider implementation
// ---------------------------------------------------------------------------

const opencodeProvider: ModelProvider = {
  id: "opencode",
  name: "OpenCode",
  description: "OpenCode AI SDK with A2A/MCP support",
  defaultModel: "claude-3-5-sonnet",
  supportedModels: ["claude-3-5-sonnet", "claude-3-5-haiku", "gpt-4o", "gpt-4o-mini"],

  async validateCredentials(credential: string): Promise<boolean> {
    try {
      const opencode = await loadOpencodeSDK();
      const client = opencode.createOpencodeClient({
        baseUrl: credential || "http://localhost:4096",
      });
      const health = await client.global.health();
      return health.data?.healthy === true;
    } catch (error: unknown) {
      logger.error("[opencode] Credential validation failed:", error);
      return true; // Allow anyway, server might not be running yet
    }
  },

  async createClient(credential: string, options?: Record<string, unknown>): Promise<ModelClient> {
    return new OpencodeClient(credential, options);
  },

  getCredentialType(): "api-key" | "oauth" | "custom" {
    return "custom";
  },
};

// ---------------------------------------------------------------------------
// Client implementation
// ---------------------------------------------------------------------------

class OpencodeClient implements ModelClient {
  private client: OpencodeClientInstance | undefined;
  private sessionId: string | null = null;

  constructor(
    private credential: string,
    private options?: Record<string, unknown>,
  ) {}

  private async getClient(): Promise<OpencodeClientInstance> {
    if (!this.client) {
      const opencode = await loadOpencodeSDK();
      this.client = opencode.createOpencodeClient({
        baseUrl: this.credential || "http://localhost:4096",
        ...this.options,
      });
    }
    return this.client;
  }

  async *query(opts: ModelQueryOptions): AsyncGenerator<unknown> {
    const client = await this.getClient();

    try {
      if (!this.sessionId) {
        const session = await client.session.create({
          body: { title: `WOPR Session ${Date.now()}` },
        });
        this.sessionId = session.data?.id ?? null;
        logger.info(`[opencode] Session created: ${this.sessionId}`);
      }

      if (!this.sessionId) {
        throw new Error("Failed to create OpenCode session");
      }

      yield { type: "system", subtype: "init", session_id: this.sessionId };

      let promptText = opts.prompt;
      if (opts.images && opts.images.length > 0) {
        const imageList = opts.images.map((url, i) => `[Image ${i + 1}]: ${url}`).join("\n");
        promptText = `[User has shared ${opts.images.length} image(s)]\n${imageList}\n\n${opts.prompt}`;
      }

      const parts: { type: string; text?: string }[] = [{ type: "text", text: promptText }];

      const resolveProviderID = (modelID: string): string => {
        if (modelID.startsWith("gpt-") || modelID.startsWith("o1") || modelID.startsWith("o3")) return "openai";
        if (modelID.startsWith("gemini-")) return "google";
        return "anthropic";
      };

      const selectedModel = opts.model ?? opencodeProvider.defaultModel;
      const promptOptions: {
        model?: { providerID: string; modelID: string };
        parts: { type: string; text?: string }[];
        enabledTools?: string[];
      } = {
        model: { providerID: resolveProviderID(selectedModel), modelID: selectedModel },
        parts,
      };

      // A2A tools
      if (opts.a2aServers && Object.keys(opts.a2aServers).length > 0) {
        const allTools: string[] = [];
        for (const [serverName, config] of Object.entries(opts.a2aServers)) {
          for (const tool of config.tools) {
            allTools.push(`mcp__${serverName}__${tool.name}`);
          }
        }
        promptOptions.enabledTools = allTools;
        logger.info(`[opencode] A2A tools configured: ${allTools.join(", ")}`);
      }

      // Allowed tools
      if (opts.allowedTools && opts.allowedTools.length > 0) {
        promptOptions.enabledTools = [...(promptOptions.enabledTools || []), ...opts.allowedTools];
        logger.info(`[opencode] Allowed tools: ${opts.allowedTools.join(", ")}`);
      }

      const result = await client.session.prompt({
        path: { id: this.sessionId },
        body: promptOptions,
      });

      if (result.data) {
        const resultParts = result.data.parts || [];

        for (const part of resultParts) {
          if (part.type === "text") {
            yield {
              type: "assistant",
              message: { content: [{ type: "text", text: part.text }] },
            };
          } else if (part.type === "tool_use" || part.type === "tool_call") {
            yield {
              type: "assistant",
              message: { content: [{ type: "tool_use", name: part.name }] },
            };
          }
        }

        yield { type: "result", subtype: "success", total_cost_usd: 0 };
      }
    } catch (error: unknown) {
      logger.error("[opencode] Query failed:", error);
      throw new Error(`OpenCode query failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async listModels(): Promise<string[]> {
    return opencodeProvider.supportedModels;
  }

  async healthCheck(): Promise<boolean> {
    try {
      const client = await this.getClient();
      const health = await client.global.health();
      return health.data?.healthy === true;
    } catch (error: unknown) {
      logger.error("[opencode] Health check failed:", error);
      return false;
    }
  }
}

// ---------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------

const manifest: PluginManifest = {
  name: "wopr-plugin-provider-opencode",
  version: "1.1.0",
  description: "OpenCode AI provider for WOPR with A2A/MCP support",
  author: "WOPR",
  license: "MIT",
  repository: "https://github.com/wopr-network/wopr-plugin-provider-opencode",
  capabilities: ["provider"],
  category: "ai-provider",
  tags: ["ai", "opencode", "provider", "a2a", "mcp"],
  icon: "🤖",
  requires: {
    network: { outbound: true },
    services: ["opencode"],
  },
  provides: {
    capabilities: [
      {
        type: "llm",
        id: "opencode",
        displayName: "OpenCode AI",
        configSchema,
      },
    ],
  },
  lifecycle: {
    shutdownBehavior: "graceful",
    hotReload: false,
  },
  configSchema,
};

// ---------------------------------------------------------------------------
// Plugin export
// ---------------------------------------------------------------------------

const plugin: WOPRPlugin = {
  name: "provider-opencode",
  version: "1.1.0",
  description: "OpenCode AI provider for WOPR with A2A/MCP support",
  manifest,

  async init(pluginCtx: WOPRPluginContext) {
    ctx = pluginCtx;
    ctx.log.info("Registering OpenCode provider...");
    ctx.registerProvider(opencodeProvider);
    cleanups.push(() => ctx?.unregisterProvider("opencode"));
    ctx.log.info("OpenCode provider registered (supports A2A/MCP)");

    ctx.registerConfigSchema("provider-opencode", configSchema);
    cleanups.push(() => ctx?.unregisterConfigSchema("provider-opencode"));
    ctx.log.info("Registered OpenCode config schema");
  },

  async shutdown() {
    for (const cleanup of cleanups.reverse()) {
      try {
        cleanup();
      } catch (_error: unknown) {
        // Best-effort cleanup
      }
    }
    cleanups.length = 0;
    ctx = null;
    logger.info("[provider-opencode] Shutting down");
  },
};

export default plugin;
