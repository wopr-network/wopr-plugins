import type { A2AServerConfig, WOPRPlugin, WOPRPluginContext } from "@wopr-network/plugin-types";
import { logger } from "./logger.js";
import { clearAllSessions, createSession, getSession, isSetupActive } from "./session-store.js";
import { createSetupTools } from "./tools.js";
import type { SetupExtension } from "./types.js";

let ctx: WOPRPluginContext | null = null;
let a2aConfig: A2AServerConfig | null = null;

const plugin: WOPRPlugin = {
  name: "wopr-plugin-setup",
  version: "0.1.0",
  description: "Conversational setup plugin — configures plugins via chat",

  async init(context: WOPRPluginContext) {
    ctx = context;

    const tools = createSetupTools(ctx);
    a2aConfig = { name: "setup", version: "0.1.0", tools };
    if (ctx.registerA2AServer) {
      ctx.registerA2AServer(a2aConfig);
      logger.info("Registered setup A2A server with 7 tools");
    }

    const extension: SetupExtension = {
      async beginSetup(pluginId, configSchema, sessionId) {
        createSession(sessionId, pluginId, configSchema);
        logger.info({ msg: "Setup session started", pluginId, sessionId });
      },
      getSession(sessionId) {
        return getSession(sessionId);
      },
      isSetupActive(sessionId) {
        return isSetupActive(sessionId);
      },
    };

    if (ctx.registerExtension) {
      ctx.registerExtension("setup", extension);
      logger.info("Registered setup extension");
    }
  },

  async shutdown() {
    if (ctx?.unregisterExtension) {
      ctx.unregisterExtension("setup");
    }
    clearAllSessions();
    logger.info("Setup plugin shut down");
  },
};

export default plugin;
