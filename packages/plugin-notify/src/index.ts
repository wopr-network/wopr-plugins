import type { ConfigSchema, PluginManifest, WOPRPlugin, WOPRPluginContext } from "@wopr-network/plugin-types";
import { buildNotifyA2ATools } from "./notify-a2a-tools.js";

let ctx: WOPRPluginContext | null = null;
const cleanups: Array<() => void> = [];

const configSchema: ConfigSchema = {
  title: "Notification Settings",
  description: "Configure notification channels and defaults",
  fields: [
    {
      name: "defaultChannel",
      type: "text",
      label: "Default Channel",
      placeholder: "e.g. alerts",
      description: "Default notification channel when none specified",
      setupFlow: "none",
    },
    {
      name: "defaultLevel",
      type: "select",
      label: "Default Level",
      description: "Default notification severity level",
      default: "info",
      setupFlow: "none",
      options: [
        { value: "info", label: "Info" },
        { value: "warn", label: "Warning" },
        { value: "error", label: "Error" },
      ],
    },
  ],
};

const manifest: PluginManifest = {
  name: "@wopr-network/wopr-plugin-notify",
  version: "1.0.0",
  description: "Notification plugin — sends notifications to configured channels via A2A tool",
  capabilities: ["notifications"],
  requires: {},
  category: "utility",
  tags: ["notifications", "alerts", "events"],
  icon: ":bell:",
  configSchema,
  lifecycle: {
    shutdownBehavior: "graceful",
  },
};

const plugin: WOPRPlugin = {
  name: "wopr-plugin-notify",
  version: "1.0.0",
  description: "Notification plugin — sends notifications to configured channels via A2A tool",
  manifest,

  async init(context: WOPRPluginContext) {
    ctx = context;

    if (ctx.registerConfigSchema) ctx.registerConfigSchema("wopr-plugin-notify", configSchema);

    if (ctx.registerA2AServer) {
      ctx.registerA2AServer(buildNotifyA2ATools(ctx));
    }

    ctx.log.info("Notify plugin initialized");
  },

  async shutdown() {
    for (const cleanup of cleanups) {
      cleanup();
    }
    cleanups.length = 0;

    if (ctx) {
      if (ctx.unregisterConfigSchema) ctx.unregisterConfigSchema("wopr-plugin-notify");
    }

    ctx = null;
  },
};

export default plugin;
