/**
 * WOPR Canvas Plugin (WOP-113 / WOP-590)
 *
 * Provides the Canvas visual workspace feature as a WOPR plugin:
 *   - Agents push HTML/Markdown/chart/form content to the WebUI via canvas tools
 *   - REST routes for WebUI and external client access
 *   - WebSocket broadcast via injected publish function (canvas:setPublish extension)
 *
 * Extension hooks:
 *   canvas:router     — Hono router mounted at /canvas by the daemon
 *   canvas:setPublish — The daemon injects its publishToTopic function here
 */

import type { PluginManifest, WOPRPlugin, WOPRPluginContext } from "@wopr-network/plugin-types";
import { createCanvasA2AServer } from "./a2a-canvas.js";
import { clearCanvasInjections, setCanvasEmitCustom, setCanvasPublish } from "./canvas.js";
import { canvasRouter } from "./routes.js";

type PublishFn = (topic: string, event: Record<string, unknown>) => void;

let ctx: WOPRPluginContext | null = null;
const cleanups: Array<() => void> = [];

const plugin: WOPRPlugin = {
  name: "@wopr-network/wopr-plugin-canvas",
  version: "1.0.0",
  description: "Canvas visual workspace plugin for WOPR — agents push visual content to the WebUI",

  manifest: {
    name: "@wopr-network/wopr-plugin-canvas",
    version: "1.0.0",
    description: "Canvas visual workspace plugin for WOPR — agents push visual content to the WebUI",
    author: "WOPR",
    license: "MIT",
    capabilities: ["canvas", "visual-workspace"],
    requires: {},
    category: "workspace",
    tags: ["canvas", "visual", "html", "markdown", "chart", "form", "workspace"],
    icon: ":art:",
    lifecycle: {
      shutdownBehavior: "graceful",
    },
  } satisfies PluginManifest,

  async init(context: WOPRPluginContext) {
    ctx = context;

    // 1. Register the REST router so the daemon can mount it at /canvas
    ctx.registerExtension("canvas:router", canvasRouter);
    cleanups.push(() => ctx?.unregisterExtension("canvas:router"));

    // 2. Register the setPublish hook so the daemon can inject its WebSocket publish function
    ctx.registerExtension("canvas:setPublish", (fn: PublishFn) => {
      setCanvasPublish(fn);
    });
    cleanups.push(() => ctx?.unregisterExtension("canvas:setPublish"));

    // 3. Wire the plugin event bus into the canvas broadcast pipeline
    setCanvasEmitCustom(
      (event: string, payload: unknown) => ctx?.events.emitCustom(event, payload) ?? Promise.resolve(),
    );

    // 4. Register canvas A2A tools per active session.
    //    New sessions created after init will get tools registered via session:create hook.
    const activeSessions = ctx.getSessions();
    for (const session of activeSessions) {
      if (ctx.registerA2AServer) {
        ctx.registerA2AServer(createCanvasA2AServer(session));
      }
    }

    // Register tools for sessions created after plugin init
    const sessionHandler = ({ session }: { session: string }) => {
      if (ctx?.registerA2AServer) {
        ctx.registerA2AServer(createCanvasA2AServer(session));
      }
    };
    const offSessionCreate = ctx.hooks.on("session:create", sessionHandler);
    cleanups.push(offSessionCreate);

    ctx.log.info("Canvas plugin initialized");
  },

  async shutdown() {
    for (const cleanup of cleanups.reverse()) {
      cleanup();
    }
    cleanups.length = 0;
    clearCanvasInjections();
    ctx = null;
  },
};

export default plugin;
