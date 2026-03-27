/**
 * WOPR ACP Plugin
 *
 * Provides ACP (Agent Client Protocol) IDE integration via NDJSON-over-stdio.
 * Registers the ACP server as a plugin extension so the daemon or CLI can
 * start it for Zed, VS Code, and other editors.
 */

import type { WOPRPlugin, WOPRPluginContext } from "@wopr-network/plugin-types";
import { AcpServer, type AcpSessionBridge } from "./server.js";

let acpServer: AcpServer | null = null;
let pluginCtx: WOPRPluginContext | null = null;
const cleanups: Array<() => void> = [];

const plugin: WOPRPlugin = {
  name: "wopr-plugin-acp",
  version: "1.0.0",
  description: "ACP IDE integration — Zed and VS Code via NDJSON stdio",
  manifest: {
    name: "wopr-plugin-acp",
    version: "1.0.0",
    description: "ACP IDE integration — Zed and VS Code via NDJSON stdio",
    capabilities: ["ide-integration"],
    category: "integration",
    tags: ["acp", "ide", "zed", "vscode", "ndjson", "stdio"],
    icon: "terminal",
    requires: {},
    provides: { capabilities: [] },
    lifecycle: { shutdownBehavior: "graceful" },
  },

  async init(ctx: WOPRPluginContext) {
    pluginCtx = ctx;

    // Build the session bridge that routes ACP requests through the plugin context
    const bridge: AcpSessionBridge = {
      async inject(session, message, options) {
        const response = await ctx.inject(session, message, {
          silent: options?.silent,
          from: options?.from,
          onStream: options?.onStream
            ? (msg) => {
                if (msg.type === "text") {
                  options.onStream?.({ type: "text", content: msg.content });
                }
              }
            : undefined,
        });
        return { response, sessionId: session };
      },
      cancelInject(session) {
        return ctx.cancelInject(session);
      },
    };

    const sessions = ctx.getSessions();
    const defaultSession = sessions[0] || "acp";

    acpServer = new AcpServer({
      bridge,
      defaultSession,
      logger: ctx.log,
    });

    // Register the ACP server as an extension so other parts of the system can access it
    ctx.registerExtension("acp:server", acpServer);

    ctx.log.info("ACP plugin initialized (server registered, call start() to begin listening)");
  },

  async shutdown() {
    if (acpServer) {
      acpServer.close();
      acpServer = null;
    }
    if (pluginCtx) {
      pluginCtx.unregisterExtension?.("acp:server");
      pluginCtx = null;
    }
    for (const fn of cleanups.splice(0)) {
      fn();
    }
  },
};

export default plugin;
export { AcpServer, type AcpServerOptions, type AcpSessionBridge } from "./server.js";
export type {
  AcpChatMessageParams,
  AcpChatResponse,
  AcpContextUpdateParams,
  AcpInitializeParams,
  AcpInitializeResult,
  AcpRequest,
  JsonRpcResponse,
} from "./types.js";
