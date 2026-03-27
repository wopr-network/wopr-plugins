import type { ConfigSchema, WOPRPlugin, WOPRPluginContext } from "@wopr-network/plugin-types";
import { PluginConfigSchema } from "./config.js";
import { logger } from "./logger.js";
import { MCPBridge } from "./mcp-bridge.js";
import { createMCPExtension } from "./mcp-extension.js";

let bridge: MCPBridge | null = null;

const configSchema: ConfigSchema = {
  title: "MCP Bridge",
  description: "Connect to MCP servers and expose their tools as A2A tools",
  fields: [
    {
      name: "servers",
      type: "object",
      label: "MCP Servers (JSON)",
      description: "Array of server configs: [{name, kind, cmd/url, args?, headers?, env?}]",
      default: [],
    },
  ],
};

const plugin: WOPRPlugin = {
  name: "wopr-plugin-mcp",
  version: "0.1.0",
  description: "Universal MCP bridge — wraps any MCP server as A2A tools",

  async init(ctx: WOPRPluginContext) {
    ctx.registerConfigSchema("wopr-plugin-mcp", configSchema);

    bridge = new MCPBridge(ctx);

    // Register extension for other plugins
    if (ctx.registerExtension) {
      ctx.registerExtension("mcp", createMCPExtension(bridge, ctx));
      logger.info("Registered MCP extension");
    }

    // Load configured servers
    const rawConfig = ctx.getConfig<{ servers?: unknown[] }>();
    const parsed = PluginConfigSchema.safeParse(rawConfig ?? {});

    if (!parsed.success) {
      logger.warn({ msg: "Invalid MCP config", errors: parsed.error.issues });
      return;
    }

    // Connect to each configured server
    for (const server of parsed.data.servers) {
      try {
        await bridge.connect(server);
      } catch (err) {
        logger.error({ msg: "Failed to connect MCP server", name: server.name, error: String(err) });
      }
    }

    logger.info({ msg: "MCP plugin initialized", serverCount: parsed.data.servers.length });
  },

  async shutdown() {
    if (bridge) {
      await bridge.disconnectAll();
      bridge = null;
    }
  },
};

export default plugin;
