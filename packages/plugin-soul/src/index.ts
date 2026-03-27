/**
 * WOPR Soul Plugin
 *
 * Provides persistent persona/identity via SOUL.md.
 * Registers:
 *   - soul.get / soul.update A2A tools
 *   - Soul context provider (priority 8)
 */

import type { WOPRPlugin, WOPRPluginContext } from "@wopr-network/plugin-types";
import { buildSoulA2ATools } from "./soul-a2a-tools.js";
import { buildSoulContextProvider } from "./soul-context-provider.js";

const CONTEXT_PROVIDER_NAME = "soul";

let ctx: WOPRPluginContext | null = null;
const cleanups: Array<() => void> = [];

const plugin: WOPRPlugin = {
  name: "wopr-plugin-soul",
  version: "1.0.0",
  description: "Soul/personality plugin — persistent agent identity via SOUL.md",

  manifest: {
    name: "wopr-plugin-soul",
    version: "1.0.0",
    description: "Soul/personality plugin — persistent agent identity via SOUL.md",
    capabilities: ["context-provider", "a2a-tools"],
    category: "personality",
    tags: ["soul", "persona", "identity", "personality"],
    icon: "ghost",
    requires: {},
    provides: {
      capabilities: [],
    },
    lifecycle: {
      shutdownBehavior: "graceful",
    },
  },

  async init(pluginCtx: WOPRPluginContext) {
    ctx = pluginCtx;

    // Register soul context provider at priority 8
    const soulContextProvider = buildSoulContextProvider(ctx);
    ctx.registerContextProvider(soulContextProvider);
    cleanups.push(() => {
      if (ctx?.unregisterContextProvider) {
        ctx.unregisterContextProvider(soulContextProvider.name);
      }
    });

    // Register A2A tools — use first available session or "default"
    const sessions = ctx.getSessions();
    const sessionName = sessions[0] || "default";
    if (ctx.registerA2AServer) {
      const a2aConfig = buildSoulA2ATools(ctx, sessionName);
      ctx.registerA2AServer(a2aConfig);
    }

    ctx.log.info("Soul plugin initialized");
  },

  async shutdown() {
    if (!ctx) return;
    for (const cleanup of cleanups.splice(0)) {
      cleanup();
    }
    ctx = null;
  },
};

export default plugin;
export { CONTEXT_PROVIDER_NAME };
