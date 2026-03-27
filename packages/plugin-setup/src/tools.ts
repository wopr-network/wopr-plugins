import type { A2AToolDefinition, A2AToolResult, ConfigField, WOPRPluginContext } from "@wopr-network/plugin-types";
import { logger } from "./logger.js";
import { deleteSession, getSession } from "./session-store.js";
import { validateKey as validateKeyFn } from "./validators.js";

const PLATFORM_BASE_URL = process.env.WOPR_PLATFORM_URL ?? "http://localhost:7437";

function textResult(text: string, isError = false): A2AToolResult {
  return { content: [{ type: "text", text }], isError };
}

let saveConfigQueue: Promise<void> = Promise.resolve();

export function createSetupTools(ctx: WOPRPluginContext): A2AToolDefinition[] {
  return [
    // 1. setup.ask
    {
      name: "setup.ask",
      description:
        "Prompt the user for a config value. Type-aware: password fields are masked, select fields show options.",
      inputSchema: {
        type: "object",
        properties: {
          sessionId: { type: "string", description: "Active setup session ID" },
          field: {
            type: "object",
            description: "ConfigField definition",
            properties: {
              name: { type: "string" },
              type: {
                type: "string",
                enum: ["text", "password", "select", "checkbox", "number", "textarea"],
              },
              label: { type: "string" },
              placeholder: { type: "string" },
              required: { type: "boolean" },
              options: {
                type: "array",
                items: {
                  type: "object",
                  properties: { value: { type: "string" }, label: { type: "string" } },
                },
              },
              description: { type: "string" },
            },
            required: ["name", "type", "label"],
          },
        },
        required: ["sessionId", "field"],
      },
      async handler(args): Promise<A2AToolResult> {
        const sessionId = args.sessionId as string;
        const field = args.field as ConfigField;
        const session = getSession(sessionId);
        if (!session) return textResult(`No active setup session: ${sessionId}`, true);

        let prompt = `Please provide: **${field.label}**`;
        if (field.description) prompt += `\n${field.description}`;
        if (field.type === "password") prompt += "\n(This value will be stored securely and never displayed.)";
        if (field.type === "select" && field.options) {
          prompt += "\n\nOptions:";
          for (const opt of field.options) {
            prompt += `\n- \`${opt.value}\` — ${opt.label}`;
          }
        }
        if (field.placeholder) prompt += `\n\nExample: \`${field.placeholder}\``;
        if (field.required) prompt += "\n\n*This field is required.*";

        return textResult(prompt);
      },
    },

    // 2. setup.validateKey
    {
      name: "setup.validateKey",
      description: "Validate an API key against a real provider endpoint.",
      inputSchema: {
        type: "object",
        properties: {
          provider: {
            type: "string",
            description: "Provider name: anthropic, openai, discord, telegram",
          },
          key: { type: "string", description: "The API key to validate" },
        },
        required: ["provider", "key"],
      },
      async handler(args): Promise<A2AToolResult> {
        const provider = args.provider as string;
        const key = args.key as string;
        const result = await validateKeyFn(provider, key);
        if (result.valid) {
          return textResult(`Key validated successfully for provider: ${provider}`);
        }
        return textResult(`Key validation failed: ${result.error}`, true);
      },
    },

    // 3. setup.installDependency
    {
      name: "setup.installDependency",
      description: "Install a required plugin dependency via the platform API.",
      inputSchema: {
        type: "object",
        properties: {
          sessionId: { type: "string", description: "Active setup session ID" },
          pluginId: {
            type: "string",
            description: "Plugin package name to install (e.g. @wopr-network/wopr-plugin-discord)",
          },
        },
        required: ["sessionId", "pluginId"],
      },
      async handler(args): Promise<A2AToolResult> {
        const sessionId = args.sessionId as string;
        const pluginId = args.pluginId as string;
        const session = getSession(sessionId);
        if (!session) return textResult(`No active setup session: ${sessionId}`, true);

        if (!pluginId.startsWith("@wopr-network/")) {
          return textResult(
            `Invalid pluginId: "${pluginId}". Only @wopr-network/ scoped packages may be installed.`,
            true,
          );
        }

        try {
          const res = await fetch(`${PLATFORM_BASE_URL}/plugins/install`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: pluginId }),
          });
          const body = (await res.json()) as { success?: boolean; error?: string };
          if (!res.ok || !body.success) {
            return textResult(`Failed to install ${pluginId}: ${body.error ?? `HTTP ${res.status}`}`, true);
          }
          session.mutations.push({ type: "installDependency", pluginId });
          logger.info({ msg: "Installed dependency", pluginId, sessionId });
          return textResult(`Successfully installed ${pluginId}`);
        } catch (err) {
          return textResult(`Failed to install ${pluginId}: ${String(err)}`, true);
        }
      },
    },

    // 4. setup.testConnection
    {
      name: "setup.testConnection",
      description: "Test a live connection to an external service.",
      inputSchema: {
        type: "object",
        properties: {
          service: {
            type: "string",
            description: "Service identifier (e.g. discord, slack, telegram)",
          },
        },
        required: ["service"],
      },
      async handler(args): Promise<A2AToolResult> {
        const service = args.service as string;
        try {
          const res = await fetch(`${PLATFORM_BASE_URL}/plugins/${service}/health`);
          if (res.ok) {
            return textResult(`Connection to ${service} is healthy.`);
          }
          const body = await res.text();
          return textResult(`Connection test failed for ${service}: HTTP ${res.status} — ${body}`, true);
        } catch (err) {
          return textResult(`Connection test failed for ${service}: ${String(err)}`, true);
        }
      },
    },

    // 5. setup.saveConfig
    {
      name: "setup.saveConfig",
      description: "Persist a config value to the tenant's encrypted vault.",
      inputSchema: {
        type: "object",
        properties: {
          sessionId: { type: "string", description: "Active setup session ID" },
          key: { type: "string", description: "Config key to save" },
          value: { description: "Config value to save" },
        },
        required: ["sessionId", "key", "value"],
      },
      async handler(args): Promise<A2AToolResult> {
        const sessionId = args.sessionId as string;
        const key = args.key as string;
        const value = args.value;
        const session = getSession(sessionId);
        if (!session) return textResult(`No active setup session: ${sessionId}`, true);

        const field = session.configSchema.fields.find((f) => f.name === key);
        if (!field) {
          return textResult(
            `Unknown config field: ${key}. Valid fields: ${session.configSchema.fields.map((f) => f.name).join(", ")}`,
            true,
          );
        }
        if (field.required && (value === null || value === undefined || value === "")) {
          return textResult(`Field "${key}" is required and cannot be empty.`, true);
        }
        if (field.pattern) {
          const regex = new RegExp(field.pattern);
          if (typeof value === "string" && !regex.test(value)) {
            return textResult(
              field.patternError ?? `Value for "${key}" does not match pattern: ${field.pattern}`,
              true,
            );
          }
        }

        const resultPromise = saveConfigQueue.then(async (): Promise<A2AToolResult> => {
          try {
            const currentConfig = ctx.getConfig<Record<string, unknown>>() ?? {};
            currentConfig[key] = value;
            await ctx.saveConfig(currentConfig);
            session.mutations.push({ type: "saveConfig", key, value });
            session.collectedValues.set(key, value);
            logger.info({ msg: "Saved config", key, sessionId });
            return textResult(`Saved "${key}" successfully.`);
          } catch (err) {
            return textResult(`Failed to save "${key}": ${String(err)}`, true);
          }
        });
        saveConfigQueue = resultPromise.then(() => undefined);
        return resultPromise;
      },
    },

    // 6. setup.complete
    {
      name: "setup.complete",
      description: "Mark setup as done, activate the plugin, and emit setup:complete event.",
      inputSchema: {
        type: "object",
        properties: {
          sessionId: { type: "string", description: "Active setup session ID" },
        },
        required: ["sessionId"],
      },
      async handler(args): Promise<A2AToolResult> {
        const sessionId = args.sessionId as string;
        const session = getSession(sessionId);
        if (!session) return textResult(`No active setup session: ${sessionId}`, true);
        if (session.completed) return textResult("Setup already completed.", true);

        const missingRequired = session.configSchema.fields
          .filter((f) => f.required && !session.collectedValues.has(f.name))
          .map((f) => f.name);
        if (missingRequired.length > 0) {
          return textResult(
            `Cannot complete setup: required field(s) not collected: ${missingRequired.join(", ")}`,
            true,
          );
        }

        session.completed = true;
        deleteSession(sessionId);

        // biome-ignore lint/suspicious/noExplicitAny: custom event not in typed map
        ctx.events.emit("setup:complete" as any, {
          pluginId: session.pluginId,
          sessionId,
          configKeys: Array.from(session.collectedValues.keys()),
        });

        logger.info({ msg: "Setup completed", pluginId: session.pluginId, sessionId });
        return textResult(`Setup complete for ${session.pluginId}. Plugin is now active.`);
      },
    },

    // 7. setup.rollback
    {
      name: "setup.rollback",
      description: "Undo all saveConfig and installDependency calls from this session. Fully transactional.",
      inputSchema: {
        type: "object",
        properties: {
          sessionId: { type: "string", description: "Active setup session ID" },
        },
        required: ["sessionId"],
      },
      async handler(args): Promise<A2AToolResult> {
        const sessionId = args.sessionId as string;
        const session = getSession(sessionId);
        if (!session) return textResult(`No active setup session: ${sessionId}`, true);

        const errors: string[] = [];

        const reversed = [...session.mutations].reverse();
        for (const mutation of reversed) {
          try {
            if (mutation.type === "saveConfig") {
              const currentConfig = ctx.getConfig<Record<string, unknown>>() ?? {};
              delete currentConfig[mutation.key];
              await ctx.saveConfig(currentConfig);
              logger.info({ msg: "Rolled back config", key: mutation.key, sessionId });
            } else if (mutation.type === "installDependency") {
              const res = await fetch(`${PLATFORM_BASE_URL}/plugins/uninstall`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name: mutation.pluginId }),
              });
              if (!res.ok) {
                errors.push(`Failed to uninstall ${mutation.pluginId}: HTTP ${res.status}`);
              } else {
                logger.info({
                  msg: "Rolled back dependency",
                  pluginId: mutation.pluginId,
                  sessionId,
                });
              }
            }
          } catch (err) {
            errors.push(`Rollback error: ${String(err)}`);
          }
        }

        session.mutations.length = 0;
        session.collectedValues.clear();
        deleteSession(sessionId);

        if (errors.length > 0) {
          return textResult(`Rollback completed with errors:\n${errors.join("\n")}`, true);
        }
        return textResult("Rollback complete. All changes undone.");
      },
    },
  ];
}
