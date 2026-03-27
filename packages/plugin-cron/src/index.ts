import type { ConfigSchema, WOPRPlugin, WOPRPluginContext } from "@wopr-network/plugin-types";
import { buildCronA2ATools } from "./cron-a2a-tools.js";
import { cronCommandHandler } from "./cron-commands.js";
import { initCronStorage, resetCronStorage } from "./cron-repository.js";
import { createCronTickLoop } from "./cron-tick.js";
import { PLUGIN_NAME } from "./plugin-name.js";

const CRON_TOOLS = ["cron_schedule", "cron_once", "cron_list", "cron_cancel", "cron_history"] as const;

/** Security registration methods added by WOP-1770; not yet in published plugin-types. */
interface SecurityRegistrationApi {
  registerPermission?(name: string): void;
  registerInjectionSource?(name: string, trustLevel: string): void;
  registerToolPermission?(toolName: string, permission: string): void;
  unregisterPermission?(name: string): void;
  unregisterInjectionSource?(name: string): void;
  unregisterToolPermission?(toolName: string): void;
}

let ctx: WOPRPluginContext | null = null;
let tickInterval: ReturnType<typeof setInterval> | null = null;
let tickInFlight: Promise<void> | null = null;

const plugin: WOPRPlugin = {
  name: PLUGIN_NAME,
  version: "1.0.0",
  description: "Cron scheduling — recurring and one-time message injection with optional script execution",

  manifest: {
    name: PLUGIN_NAME,
    version: "1.0.0",
    description: "Cron scheduling — recurring and one-time message injection with optional script execution",
    capabilities: ["scheduling", "automation"],
    category: "utility",
    tags: ["cron", "scheduling", "automation", "timer"],
    icon: ":clock3:",
    lifecycle: { shutdownBehavior: "graceful" },
    requires: {},
    configSchema: {
      title: "Cron Plugin",
      description: "Settings for the cron scheduling plugin",
      fields: [
        {
          name: "cronScriptsEnabled",
          type: "checkbox",
          label: "Enable Cron Scripts",
          description:
            "Allow cron jobs to execute shell scripts before sending messages. Scripts run with the daemon's permissions.",
          default: false,
          required: false,
        },
      ],
    } satisfies ConfigSchema,
  },

  commands: [
    {
      name: "cron",
      description: "Manage scheduled injections (add, remove, list, once, now)",
      usage: "cron <add|remove|list|once|now> [args]",
      handler: cronCommandHandler,
    },
  ],

  async init(context: WOPRPluginContext) {
    ctx = context;

    // 1. Register storage schema and get repositories
    await initCronStorage(ctx.storage);

    // 2. Register security metadata (after storage init succeeds)
    const c = ctx as WOPRPluginContext & SecurityRegistrationApi;
    c.registerPermission?.("cron.manage");
    c.registerInjectionSource?.("cron", "owner");
    for (const tool of CRON_TOOLS) {
      c.registerToolPermission?.(tool, "cron.manage");
    }

    // 3. Start tick loop (30s interval)
    const cronTick = createCronTickLoop(ctx);
    const wrappedTick = () => {
      tickInFlight = cronTick().finally(() => {
        tickInFlight = null;
      });
    };
    tickInterval = setInterval(wrappedTick, 30000);
    wrappedTick(); // Run immediately on startup

    // 3. Register A2A tools
    if (ctx.registerA2AServer) {
      ctx.registerA2AServer(buildCronA2ATools());
    }

    ctx.log.info("Cron plugin initialized");
  },

  async shutdown() {
    if (tickInterval) {
      clearInterval(tickInterval);
      tickInterval = null;
    }
    if (tickInFlight) {
      await tickInFlight;
    }
    if (ctx) {
      const c = ctx as WOPRPluginContext & SecurityRegistrationApi;
      // Unregister tool-permission mappings before removing the permission they reference
      for (const tool of CRON_TOOLS) {
        c.unregisterToolPermission?.(tool);
      }
      c.unregisterPermission?.("cron.manage");
      c.unregisterInjectionSource?.("cron");
    }
    resetCronStorage();
    ctx = null;
  },
};

export default plugin;
