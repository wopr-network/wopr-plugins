import type { WOPRPlugin, WOPRPluginContext } from "@wopr-network/plugin-types";
import { createMetricsA2AServer } from "./a2a-tools.js";
import { MetricsStore } from "./metrics-store.js";
import { createMetricsRouter } from "./routes.js";

let metricsStore: MetricsStore | null = null;

const plugin: WOPRPlugin = {
  name: "@wopr-network/wopr-plugin-metrics",
  version: "1.0.0",
  description: "Metrics and observability plugin — records, queries, and exports platform metrics",

  manifest: {
    name: "@wopr-network/wopr-plugin-metrics",
    version: "1.0.0",
    description: "Metrics and observability plugin — records, queries, and exports platform metrics",
    capabilities: ["metrics", "observability"],
    category: "observability",
    tags: ["metrics", "monitoring", "observability"],
    icon: "📊",
  },

  async init(ctx: WOPRPluginContext): Promise<void> {
    if (metricsStore !== null) {
      ctx.log.info("[metrics] Plugin already initialized, skipping");
      return;
    }

    ctx.log.info("[metrics] Initializing metrics plugin...");

    // Create the MetricsStore using the Storage API from the plugin context
    metricsStore = await MetricsStore.create(ctx.storage);
    ctx.log.info("[metrics] MetricsStore initialized");

    // Register the Hono router as an extension so the daemon can mount it
    const router = createMetricsRouter(metricsStore);
    ctx.registerExtension("metrics:router", router);
    ctx.log.info("[metrics] REST routes registered as extension");

    // Register A2A tools
    if (ctx.registerA2AServer) {
      const a2aServer = createMetricsA2AServer(metricsStore);
      ctx.registerA2AServer(a2aServer);
      ctx.log.info("[metrics] A2A tools registered");
    }

    ctx.log.info("[metrics] Plugin initialized");
  },

  async shutdown(): Promise<void> {
    metricsStore = null;
  },
};

export default plugin;
