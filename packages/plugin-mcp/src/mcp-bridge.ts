import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { A2AServerConfig, A2AToolDefinition, A2AToolResult, WOPRPluginContext } from "@wopr-network/plugin-types";
import type { ServerConfig } from "./config.js";
import { logger } from "./logger.js";
import { createTransport } from "./transports.js";
import type { ConnectedServer } from "./types.js";

export class MCPBridge {
  private servers = new Map<string, ConnectedServer>();
  private ctx: WOPRPluginContext;

  constructor(ctx: WOPRPluginContext) {
    this.ctx = ctx;
  }

  async connect(config: ServerConfig): Promise<void> {
    if (this.servers.has(config.name)) {
      logger.warn({
        msg: "Reconnecting to MCP server — old A2A tool registrations will NOT be unregistered (platform reload required to clear stale tools)",
        name: config.name,
      });
      await this.disconnect(config.name);
    }

    const transport = createTransport(config);
    const client = new Client({ name: `wopr-mcp-${config.name}`, version: "0.1.0" }, { capabilities: {} });

    await client.connect(transport);
    logger.info({ msg: "Connected to MCP server", name: config.name, kind: config.kind });

    // Discover tools
    const { tools } = await client.listTools();
    const a2aTools: A2AToolDefinition[] = tools.map((tool) => ({
      name: `${config.name}.${tool.name}`,
      description: tool.description ?? `Tool ${tool.name} from ${config.name}`,
      inputSchema: (tool.inputSchema as Record<string, unknown>) ?? { type: "object", properties: {} },
      handler: async (args: Record<string, unknown>): Promise<A2AToolResult> => {
        const result = await client.callTool({ name: tool.name, arguments: args });
        return {
          content: (result.content as A2AToolResult["content"]) ?? [{ type: "text", text: JSON.stringify(result) }],
          isError: result.isError === true,
        };
      },
    }));

    const a2aConfig: A2AServerConfig = {
      name: `mcp-${config.name}`,
      version: "0.1.0",
      tools: a2aTools,
    };

    if (!this.ctx.registerA2AServer) {
      throw new Error(
        `registerA2AServer is not available on WOPRPluginContext — cannot register tools for MCP server "${config.name}". Plugin may be running against an incompatible platform version.`,
      );
    }
    this.ctx.registerA2AServer(a2aConfig);
    logger.info({
      msg: "Registered A2A tools",
      server: config.name,
      toolCount: a2aTools.length,
      tools: a2aTools.map((t) => t.name),
    });

    this.servers.set(config.name, {
      config,
      client,
      transport,
      toolNames: a2aTools.map((t) => t.name),
    });
  }

  async disconnect(name: string): Promise<void> {
    const server = this.servers.get(name);
    if (!server) return;

    try {
      await server.client.close();
    } catch (err) {
      logger.warn({ msg: "Error closing MCP client", name, error: String(err) });
    }

    // Unregister A2A server if platform supports it (optional future API)
    const ctxExt = this.ctx as WOPRPluginContext & { unregisterA2AServer?: (name: string) => void };
    if (ctxExt.unregisterA2AServer) {
      ctxExt.unregisterA2AServer(`mcp-${name}`);
    } else {
      logger.warn({ msg: "unregisterA2AServer not available — A2A tools will persist until plugin reload", name });
    }

    this.servers.delete(name);
    logger.info({ msg: "Disconnected MCP server", name });
  }

  async disconnectAll(): Promise<void> {
    const names = [...this.servers.keys()];
    await Promise.all(names.map((n) => this.disconnect(n)));
  }

  listServers(): Array<{ name: string; kind: string; toolCount: number }> {
    return [...this.servers.values()].map((s) => ({
      name: s.config.name,
      kind: s.config.kind,
      toolCount: s.toolNames.length,
    }));
  }
}
