import type { A2AServerConfig, WOPRPluginContext } from "@wopr-network/plugin-types";

export function buildNotifyA2ATools(ctx: WOPRPluginContext): A2AServerConfig {
  return {
    name: "notify",
    version: "1.0.0",
    tools: [
      {
        name: "notify.send",
        description: "Send a notification to configured channels.",
        inputSchema: {
          type: "object",
          properties: {
            message: { type: "string", description: "Notification message" },
            level: { type: "string", description: "Level: info, warn, error" },
            channel: { type: "string", description: "Specific channel to notify" },
          },
          required: ["message"],
        },
        async handler(args) {
          const {
            message,
            level = "info",
            channel,
          } = args as {
            message: string;
            level?: string;
            channel?: string;
          };

          const logLevel = level === "error" ? "error" : level === "warn" ? "warn" : "info";
          ctx.log[logLevel](`[NOTIFY] ${message}`);

          await ctx.events.emitCustom("notification:send", {
            message,
            level,
            channel,
          });

          return {
            content: [{ type: "text", text: `Notification sent: [${level.toUpperCase()}] ${message}` }],
          };
        },
      },
    ],
  };
}
