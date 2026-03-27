import type { WOPRPluginContext } from "@wopr-network/plugin-types";
import type { ServerConfig } from "./config.js";
import type { MCPBridge } from "./mcp-bridge.js";
import type { MCPExtension } from "./types.js";

interface PersistableConfig {
  servers: ServerConfig[];
}

export function createMCPExtension(bridge: MCPBridge, ctx: WOPRPluginContext): MCPExtension {
  return {
    async connect(config: ServerConfig): Promise<void> {
      await bridge.connect(config);

      // Persist to config so it survives restart
      const current = ctx.getConfig<PersistableConfig>() ?? { servers: [] };
      const filtered = (current.servers ?? []).filter((s) => s.name !== config.name);
      await ctx.saveConfig({ servers: [...filtered, config] });
    },
    async disconnect(name: string): Promise<void> {
      await bridge.disconnect(name);

      // Remove from persisted config
      const current = ctx.getConfig<PersistableConfig>() ?? { servers: [] };
      await ctx.saveConfig({ servers: (current.servers ?? []).filter((s) => s.name !== name) });
    },
    listServers() {
      return bridge.listServers();
    },
  };
}
