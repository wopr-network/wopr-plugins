import { createExecCommandHandler } from "./exec-command.js";
import type { ConfigSchema, ExecPluginConfig, PluginManifest, WOPRPlugin, WOPRPluginContext } from "./types.js";

let ctx: WOPRPluginContext | null = null;

function getConfig(): ExecPluginConfig {
  if (!ctx) return {};
  const raw = ctx.getConfig<Record<string, unknown>>() ?? {};
  return {
    allowedCommands:
      raw.allowedCommands !== undefined
        ? String(raw.allowedCommands)
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
        : undefined,
    blockShellOperators: raw.blockShellOperators as boolean | undefined,
    maxExecTimeout: raw.maxExecTimeout as number | undefined,
    maxOutputSize: raw.maxOutputSize as number | undefined,
    stripEnv: raw.stripEnv as boolean | undefined,
  };
}

const configSchema: ConfigSchema = {
  title: "Exec Plugin",
  description: "Configure security policies for shell exec",
  fields: [
    {
      name: "allowedCommands",
      type: "text",
      label: "Allowed Commands",
      placeholder: "ls, cat, grep, ... (comma-separated, empty = default safe set)",
      description: "Comma-separated list of allowed commands for exec_command (non-sandboxed mode only).",
      setupFlow: "paste",
    },
  ],
};

const manifest: PluginManifest = {
  name: "wopr-plugin-exec",
  version: "0.1.0",
  description: "Provides shell command execution capability",
  capabilities: ["a2a"],
  configSchema,
  dependencies: [],
};

const plugin: WOPRPlugin = {
  name: "wopr-plugin-exec",
  version: "0.1.0",
  description: "Shell exec capability",
  manifest,

  async init(context: WOPRPluginContext) {
    ctx = context;
    context.registerConfigSchema("wopr-plugin-exec", configSchema);

    if (!context.registerA2AServer) {
      context.log.error("registerA2AServer not available - cannot register tools");
      return;
    }

    const execCommandHandler = createExecCommandHandler(getConfig);

    context.registerA2AServer({
      name: "wopr-plugin-exec",
      version: "0.1.0",
      tools: [
        {
          name: "exec_command",
          description:
            "Execute a shell command. Only safe commands allowed (ls, cat, grep, etc.) unless admin configures otherwise.",
          inputSchema: {
            type: "object",
            properties: {
              command: { type: "string", description: "Command to execute" },
              cwd: { type: "string", description: "Working directory" },
              timeout: {
                type: "number",
                description: "Timeout in ms (default: 10000, max: 60000)",
              },
            },
            required: ["command"],
          },
          handler: execCommandHandler,
        },
      ],
    });

    context.log.info("Exec plugin initialized: exec_command registered");
  },
};

export default plugin;
