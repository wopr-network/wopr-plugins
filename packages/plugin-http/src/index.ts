import { createHttpFetchHandler } from "./http-fetch.js";
import type { ConfigSchema, HttpPluginConfig, PluginManifest, WOPRPlugin, WOPRPluginContext } from "./types.js";

let ctx: WOPRPluginContext | null = null;

function getConfig(): HttpPluginConfig {
  if (!ctx) return {};
  const raw = ctx.getConfig<Record<string, unknown>>() ?? {};
  return {
    allowedDomains:
      raw.allowedDomains !== undefined
        ? String(raw.allowedDomains)
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
        : undefined,
    blockedDomains:
      raw.blockedDomains !== undefined
        ? String(raw.blockedDomains)
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
        : undefined,
    maxTimeout: raw.maxTimeout as number | undefined,
    maxResponseSize: raw.maxResponseSize as number | undefined,
  };
}

const configSchema: ConfigSchema = {
  title: "HTTP Plugin",
  description: "Configure security policies for HTTP fetch",
  fields: [
    {
      name: "allowedDomains",
      type: "text",
      label: "Allowed Domains",
      placeholder: "api.example.com, cdn.example.com (comma-separated, empty = all)",
      description: "Comma-separated list of allowed domains for http_fetch. Empty means all domains allowed.",
      setupFlow: "paste",
    },
    {
      name: "blockedDomains",
      type: "text",
      label: "Blocked Domains",
      placeholder: "internal.corp, 169.254.169.254 (comma-separated)",
      description:
        "Comma-separated list of blocked domains (takes priority over allowed list). Always block metadata endpoints.",
      setupFlow: "paste",
    },
  ],
};

const manifest: PluginManifest = {
  name: "wopr-plugin-http",
  version: "0.1.0",
  description: "Provides HTTP fetch capability for making external requests",
  capabilities: ["a2a"],
  configSchema,
  dependencies: [],
};

const plugin: WOPRPlugin = {
  name: "wopr-plugin-http",
  version: "0.1.0",
  description: "HTTP fetch capability",
  manifest,

  async init(context: WOPRPluginContext) {
    ctx = context;
    context.registerConfigSchema("wopr-plugin-http", configSchema);

    if (!context.registerA2AServer) {
      context.log.error("registerA2AServer not available - cannot register tools");
      return;
    }

    const httpFetchHandler = createHttpFetchHandler(getConfig);

    context.registerA2AServer({
      name: "wopr-plugin-http",
      version: "0.1.0",
      tools: [
        {
          name: "http_fetch",
          description:
            "Make an HTTP request to an external URL. Supports arbitrary headers including Authorization, API keys, etc.",
          inputSchema: {
            type: "object",
            properties: {
              url: { type: "string", description: "URL to fetch" },
              method: { type: "string", description: "HTTP method (default: GET)" },
              headers: {
                type: "object",
                description: "Request headers as key-value pairs",
                additionalProperties: { type: "string" },
              },
              body: { type: "string", description: "Request body (for POST, PUT, PATCH)" },
              timeout: { type: "number", description: "Timeout in ms (default: 30000)" },
              includeHeaders: {
                type: "boolean",
                description: "Include response headers in output (default: false)",
              },
            },
            required: ["url"],
          },
          handler: httpFetchHandler,
        },
      ],
    });

    context.log.info("HTTP plugin initialized: http_fetch registered");
  },
};

export default plugin;
