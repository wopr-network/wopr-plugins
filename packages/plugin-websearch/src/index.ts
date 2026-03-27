import type { ConfigSchema, PluginManifest, WOPRPlugin, WOPRPluginContext } from "@wopr-network/plugin-types";
import { buildWebSearchA2ATools } from "./web-search.js";

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------
let ctx: WOPRPluginContext | null = null;
const cleanups: Array<() => void> = [];

// ---------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------
const manifest: PluginManifest = {
  name: "@wopr-network/wopr-plugin-websearch",
  version: "1.0.0",
  description: "Web search via Brave, Google, and xAI with fallback chain and SSRF protection",
  author: "WOPR",
  license: "MIT",
  capabilities: ["web-search"],
  category: "search",
  tags: ["web-search", "brave", "google", "xai", "search", "ssrf"],
  icon: "search",
  requires: {
    network: { outbound: true },
  },
  provides: {
    capabilities: [
      {
        type: "web-search",
        id: "wopr-websearch",
        displayName: "Web Search",
        tier: "byok",
      },
    ],
  },
  lifecycle: {
    shutdownBehavior: "graceful",
    shutdownTimeoutMs: 5_000,
  },
};

// ---------------------------------------------------------------------------
// Config schema
// ---------------------------------------------------------------------------
const configSchema: ConfigSchema = {
  title: "Web Search",
  description: "Configure web search providers",
  fields: [
    {
      name: "googleApiKey",
      type: "password",
      label: "Google API Key",
      placeholder: "Google Custom Search API key",
      description: "API key for Google Custom Search",
    },
    {
      name: "googleCx",
      type: "text",
      label: "Google CX ID",
      placeholder: "Custom Search Engine ID",
      description: "Google Custom Search Engine ID",
    },
    {
      name: "braveApiKey",
      type: "password",
      label: "Brave API Key",
      placeholder: "Brave Search API key",
      description: "API key for Brave Search",
    },
    {
      name: "xaiApiKey",
      type: "password",
      label: "xAI API Key",
      placeholder: "xAI/Grok API key",
      description: "API key for xAI (Grok) search",
    },
  ],
};

// ---------------------------------------------------------------------------
// Plugin definition
// ---------------------------------------------------------------------------
const plugin: WOPRPlugin = {
  name: "wopr-plugin-websearch",
  version: "1.0.0",
  description: "Web search via Brave, Google, and xAI with fallback chain and SSRF protection",
  manifest,

  async init(context: WOPRPluginContext) {
    ctx = context;

    // Register config schema
    if (ctx.registerConfigSchema) {
      ctx.registerConfigSchema("wopr-plugin-websearch", configSchema);
    }

    // Register A2A server
    if (ctx.registerA2AServer) {
      ctx.registerA2AServer(buildWebSearchA2ATools({}));
      // A2A server cleanup is handled by the platform on unregister
    }

    ctx.log.info("Web search plugin initialized");
  },

  async shutdown() {
    // Run cleanups in LIFO order
    let fn = cleanups.pop();
    while (fn !== undefined) {
      try {
        fn();
      } catch {
        // Best-effort cleanup
      }
      fn = cleanups.pop();
    }
    ctx = null;
  },
};

export default plugin;

export { BraveSearchProvider } from "./providers/brave.js";
export { GoogleSearchProvider } from "./providers/google.js";
export type { WebSearchProvider, WebSearchProviderConfig, WebSearchResult } from "./providers/index.js";
export { XaiSearchProvider } from "./providers/xai.js";
// Re-export types for consumers
export type { WebSearchPluginConfig } from "./web-search.js";
export { isPrivateUrl } from "./web-search.js";
