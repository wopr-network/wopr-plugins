/**
 * WOPR Plugin: Moonshot AI Kimi Provider (OAuth)
 *
 * Provides Kimi AI access via the Kimi Agent SDK.
 * Supports A2A tools via MCP server configuration.
 * Install: wopr plugin install wopr-plugin-provider-kimi
 */

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { A2AServerConfig, PluginManifest, WOPRPlugin, WOPRPluginContext } from "@wopr-network/plugin-types";
import winston from "winston";

// Provider-specific types (not part of plugin-types — these are runtime interfaces
// between WOPR core and provider plugins, not yet standardized in plugin-types)
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

// Setup winston logger
const logger = winston.createLogger({
  level: "info",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json(),
  ),
  defaultMeta: { service: "wopr-plugin-provider-kimi" },
  transports: [new winston.transports.Console({ level: "warn" })],
});

const KIMI_PATH = join(homedir(), ".local/share/uv/tools/kimi-cli/bin/kimi");

interface RetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  retryableStatusCodes?: number[];
}

export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = {},
  logger: { warn: (msg: string) => void },
): Promise<T> {
  const maxRetries = opts.maxRetries ?? 3;
  const baseDelayMs = opts.baseDelayMs ?? 1000;
  const retryableCodes = opts.retryableStatusCodes ?? [429, 503];

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: unknown) {
      if (attempt === maxRetries) throw error;

      const msg = error instanceof Error ? error.message : String(error);
      const status = (error as any)?.status ?? (error as any)?.statusCode;
      const isRetryable =
        (status && retryableCodes.includes(status)) ||
        msg.includes("ECONNRESET") ||
        msg.includes("ECONNREFUSED") ||
        msg.includes("ETIMEDOUT") ||
        msg.includes("fetch failed") ||
        msg.includes("network") ||
        msg.includes("socket hang up");

      if (!isRetryable) throw error;

      const delay = baseDelayMs * 2 ** attempt;
      logger.warn(
        `[retry] Attempt ${attempt + 1}/${maxRetries} failed (${status || msg.slice(0, 80)}), retrying in ${delay}ms`,
      );
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw new Error("unreachable");
}

function getKimiPath(): string {
  if (existsSync(KIMI_PATH)) return KIMI_PATH;
  return "kimi";
}

async function loadSDK(): Promise<any> {
  return await import("@moonshot-ai/kimi-agent-sdk");
}

/**
 * Convert A2A server configs to Kimi MCP config format
 * Kimi expects: { mcpServers: { name: { url: string } | { command: string, args: string[] } } }
 */
function convertA2AToKimiMcpConfig(a2aServers: Record<string, A2AServerConfig>): Record<string, any> {
  const mcpServers: Record<string, any> = {};

  for (const [serverName, config] of Object.entries(a2aServers)) {
    // For A2A servers, we create a virtual MCP config
    // The actual tool execution is handled by WOPR's A2A system
    mcpServers[serverName] = {
      // Mark as WOPR-managed A2A server
      woprA2A: true,
      name: config.name,
      version: config.version || "1.0.0",
      tools: config.tools.map((t) => t.name),
    };
    logger.info(`[kimi] Registered A2A server: ${serverName} with ${config.tools.length} tools`);
  }

  return mcpServers;
}

// Static model metadata for extension enrichment (WOP-268)
const KIMI_MODEL_INFO = [
  {
    id: "kimi-k2",
    name: "Kimi K2",
    contextWindow: 128000,
    maxOutput: 8000,
    legacy: false,
  },
];

/**
 * Kimi provider implementation
 */
const kimiProvider: ModelProvider = {
  id: "kimi",
  name: "Kimi",
  description: "Moonshot AI Kimi Code CLI with OAuth and A2A/MCP support",
  defaultModel: "kimi-k2",
  supportedModels: ["kimi-k2"],

  async validateCredentials(): Promise<boolean> {
    try {
      const { createSession } = await loadSDK();
      const session = createSession({
        workDir: "/tmp",
        executable: getKimiPath(),
        yoloMode: true,
      });
      await session.close();
      return true;
    } catch (error: unknown) {
      logger.error("[kimi] Credential validation failed:", error);
      return false;
    }
  },

  async createClient(_credential: string, options?: Record<string, unknown>): Promise<ModelClient> {
    return new KimiClient(options);
  },

  getCredentialType(): "api-key" | "oauth" | "custom" {
    return "oauth";
  },
};

/**
 * Kimi client implementation with A2A support
 */
class KimiClient implements ModelClient {
  private executable: string;

  constructor(private options?: Record<string, unknown>) {
    this.executable = getKimiPath();
  }

  async *query(opts: ModelQueryOptions): AsyncGenerator<unknown> {
    const { createSession } = await loadSDK();
    const sessionOptions: any = {
      workDir: "/tmp",
      executable: this.executable,
      yoloMode: true, // Auto-approve filesystem operations
      ...this.options,
    };

    // Session resumption
    if (opts.resume) {
      sessionOptions.sessionId = opts.resume;
      logger.info(`[kimi] Resuming session: ${opts.resume}`);
    }

    // A2A MCP server support
    // Kimi uses mcpConfig for MCP integration
    if (opts.a2aServers && Object.keys(opts.a2aServers).length > 0) {
      sessionOptions.mcpConfig = {
        mcpServers: convertA2AToKimiMcpConfig(opts.a2aServers),
      };
      logger.info(`[kimi] A2A MCP servers configured: ${Object.keys(opts.a2aServers).join(", ")}`);
    }

    const session = createSession(sessionOptions);

    // Yield session ID so WOPR can persist it for resumption
    yield { type: "system", subtype: "init", session_id: session.sessionId };

    try {
      let promptText = opts.prompt;
      if (opts.images?.length) {
        const imageList = opts.images.map((url: string, i: number) => `[Image ${i + 1}]: ${url}`).join("\n");
        promptText = `[User has shared ${opts.images.length} image(s)]\n${imageList}\n\n${promptText}`;
      }
      if (opts.systemPrompt) promptText = `${opts.systemPrompt}\n\n${promptText}`;

      const maxRetries = 3;
      const baseDelayMs = 1000;
      const retryableMsgs = ["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "fetch failed", "network", "socket hang up"];
      let lastError: unknown;
      let eventsYielded = false;
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          const turn = session.prompt(promptText);
          // NOTE: Mid-stream retry hazard — if session.prompt() yields partial
          // events before throwing, the caller has already received those partial
          // events and they cannot be un-sent. Retries here apply only to
          // complete-failure scenarios (network errors before or during the stream).
          // This is a known limitation of streaming retry.
          for await (const event of turn) {
            if (event.type === "ContentPart" && event.payload?.type === "text") {
              eventsYielded = true;
              yield {
                type: "assistant",
                message: {
                  content: [{ type: "text", text: event.payload.text }],
                },
              };
            } else if (event.type === "ToolUse") {
              eventsYielded = true;
              yield {
                type: "assistant",
                message: {
                  content: [{ type: "tool_use", name: event.payload?.name }],
                },
              };
            }
          }
          await turn.result;
          lastError = undefined;
          break;
        } catch (err: unknown) {
          if (attempt === maxRetries) throw err;
          // Do not retry if events were already yielded to the caller —
          // partial output cannot be un-yielded and a retry would produce
          // a duplicate/split response.
          if (eventsYielded) throw err;
          const msg = err instanceof Error ? err.message : String(err);
          const status = (err as any)?.status ?? (err as any)?.statusCode;
          const isRetryable = [429, 503].includes(status) || retryableMsgs.some((s) => msg.includes(s));
          if (!isRetryable) throw err;
          const delay = baseDelayMs * 2 ** attempt;
          logger.warn(
            `[retry] Attempt ${attempt + 1}/${maxRetries} failed (${status || msg.slice(0, 80)}), retrying in ${delay}ms`,
          );
          await new Promise((r) => setTimeout(r, delay));
          lastError = err;
        }
      }
      if (lastError) throw lastError;
      yield { type: "result", subtype: "success", total_cost_usd: 0 };
      await session.close();
    } catch (error: unknown) {
      logger.error("[kimi] Query failed:", error);
      await session.close();
      throw error;
    }
  }

  async listModels(): Promise<string[]> {
    return ["kimi-k2"];
  }

  async healthCheck(): Promise<boolean> {
    try {
      const { createSession } = await loadSDK();
      await retryWithBackoff(
        async () => {
          const session = createSession({
            workDir: "/tmp",
            executable: this.executable,
          });
          await session.close();
        },
        { maxRetries: 3, baseDelayMs: 1000 },
        logger,
      );
      return true;
    } catch (error: unknown) {
      logger.error("[kimi] Health check failed:", error);
      return false;
    }
  }
}

/**
 * Plugin manifest for WaaS discovery and auto-configuration.
 */
const manifest: PluginManifest = {
  name: "@wopr-network/wopr-plugin-provider-kimi",
  version: "1.6.0",
  description: "Moonshot AI Kimi Code CLI provider with OAuth and A2A/MCP support",
  author: "wopr-network",
  license: "MIT",
  repository: "https://github.com/wopr-network/wopr-plugin-provider-kimi",
  capabilities: ["provider"],
  category: "ai-provider",
  tags: ["kimi", "moonshot", "oauth", "a2a", "mcp"],
  icon: "🌙",
  requires: {
    bins: ["kimi"],
    os: ["linux", "darwin"],
    network: { outbound: true },
  },
  install: [
    {
      kind: "pip",
      package: "kimi-cli",
      bins: ["kimi"],
      label: "Kimi CLI (via uv/pip)",
    },
  ],
  configSchema: {
    title: "Kimi",
    description: "Configure Moonshot AI Kimi settings",
    fields: [
      {
        name: "kimiPath",
        type: "text",
        label: "Kimi CLI Path",
        placeholder: "kimi (or full path)",
        required: false,
        description: "Path to Kimi CLI executable (defaults to 'kimi')",
        setupFlow: "none",
      },
    ],
  },
  setup: [
    {
      id: "kimi-oauth",
      title: "Kimi OAuth Login",
      description: "Authenticate with Moonshot AI via `kimi auth login`. The CLI handles OAuth automatically.",
      optional: false,
    },
  ],
  lifecycle: {
    shutdownBehavior: "graceful",
  },
};

/**
 * Plugin export
 */
let pluginCtx: WOPRPluginContext | null = null;

const plugin: WOPRPlugin = {
  name: "provider-kimi",
  version: "1.6.0",
  description: "Moonshot AI Kimi Code CLI provider with A2A/MCP support",
  manifest,

  async init(ctx: WOPRPluginContext) {
    pluginCtx = ctx;
    ctx.log.info("Registering Kimi provider (OAuth)...");
    ctx.registerProvider(kimiProvider);
    ctx.log.info("Kimi provider registered (supports session resumption, yoloMode, A2A/MCP)");

    // Register extension for daemon model endpoint enrichment (WOP-268)
    if (ctx.registerExtension) {
      ctx.registerExtension("provider-kimi", {
        getModelInfo: async () => KIMI_MODEL_INFO,
      });
      ctx.log.info("Registered provider-kimi extension");
    }

    // Register config schema for UI (also available via manifest.configSchema)
    ctx.registerConfigSchema("provider-kimi", manifest.configSchema!);
    ctx.log.info("Registered Kimi config schema");
  },

  async shutdown() {
    logger.info("[provider-kimi] Shutting down");
    pluginCtx?.unregisterExtension?.("provider-kimi");
    pluginCtx?.unregisterConfigSchema?.("provider-kimi");
    pluginCtx = null;
  },
};

export default plugin;
