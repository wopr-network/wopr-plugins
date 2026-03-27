/**
 * WOPR Slack Plugin
 *
 * Supports both Socket Mode (default) and HTTP webhook mode.
 * Uses @slack/bolt for robust event handling.
 */

import { randomUUID } from "node:crypto";
import path from "node:path";
import type { App } from "@slack/bolt";
import winston from "winston";
import { initSlackApp } from "./app-init.js";
import { registerSlashCommands } from "./commands.js";
import { handleMessage, type MessageHandlerDeps } from "./message-handler.js";
import { approveUser, claimPairingCode, cleanupExpiredPairings } from "./pairing.js";
import { withRetry } from "./retry.js";
import type {
  AgentIdentity,
  ChannelCommand,
  ChannelMessageParser,
  ChannelNotificationCallbacks,
  ChannelNotificationPayload,
  ConfigSchema,
  RetryConfig,
  SlackChannelProvider,
  SlackConfig,
  WOPRPlugin,
  WOPRPluginContext,
} from "./types.js";
import { stopAllTyping } from "./typing.js";

export { saveAttachments } from "./attachments.js";

const logger = winston.createLogger({
  level: "debug",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json(),
  ),
  defaultMeta: { service: "wopr-plugin-slack" },
  transports: [
    new winston.transports.File({
      filename: path.join(process.env.WOPR_HOME || "/tmp/wopr-test", "logs", "slack-plugin-error.log"),
      level: "error",
    }),
    new winston.transports.File({
      filename: path.join(process.env.WOPR_HOME || "/tmp/wopr-test", "logs", "slack-plugin.log"),
      level: "debug",
    }),
    new winston.transports.Console({
      format: winston.format.combine(winston.format.colorize(), winston.format.simple()),
      level: "warn",
    }),
  ],
});

let app: App | null = null;
let ctx: WOPRPluginContext | null = null;
let agentIdentity: AgentIdentity = { name: "WOPR", emoji: "👀" };
let cleanupTimer: NodeJS.Timeout | null = null;
let retryConfig: RetryConfig = {};
const cleanups: Array<() => void | Promise<void>> = [];

/**
 * Build retry options with logging for a Slack API call
 */
function retryOpts(label: string) {
  return {
    ...retryConfig,
    onRetry: (attempt: number, delay: number, error: unknown) => {
      logger.warn({
        msg: `Retrying Slack API call: ${label}`,
        attempt,
        delay,
        error: String(error),
      });
    },
  };
}

function escapeMrkdwn(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ============================================================================
// Channel Provider (cross-plugin command/parser registration)
// ============================================================================

const registeredCommands: Map<string, ChannelCommand> = new Map();
const registeredParsers: Map<string, ChannelMessageParser> = new Map();

const NOTIFICATION_TTL_MS = 15 * 60 * 1000; // 15 minutes

interface PendingNotification {
  callbacks: ChannelNotificationCallbacks;
  channelId: string;
  createdAt: number;
}

const pendingNotifications = new Map<string, PendingNotification>();

const slackChannelProvider: SlackChannelProvider = {
  id: "slack",

  registerCommand(cmd: ChannelCommand): void {
    registeredCommands.set(cmd.name, cmd);
    logger.info({ msg: "Channel command registered", name: cmd.name });
  },

  unregisterCommand(name: string): void {
    registeredCommands.delete(name);
  },

  getCommands(): ChannelCommand[] {
    return Array.from(registeredCommands.values());
  },

  addMessageParser(parser: ChannelMessageParser): void {
    registeredParsers.set(parser.id, parser);
    logger.info({ msg: "Message parser registered", id: parser.id });
  },

  removeMessageParser(id: string): void {
    registeredParsers.delete(id);
  },

  getMessageParsers(): ChannelMessageParser[] {
    return Array.from(registeredParsers.values());
  },

  async send(channelId: string, content: string): Promise<void> {
    if (!app) throw new Error("Slack app not initialized");
    const slackApp = app;
    // Split content into chunks of SLACK_LIMIT chars
    const chunks: string[] = [];
    let remaining = content;
    while (remaining.length > 0) {
      if (remaining.length <= SLACK_LIMIT) {
        chunks.push(remaining);
        break;
      }
      let splitAt = remaining.lastIndexOf("\n", SLACK_LIMIT);
      if (splitAt < SLACK_LIMIT - 500) splitAt = remaining.lastIndexOf(" ", SLACK_LIMIT);
      if (splitAt < SLACK_LIMIT - 500) splitAt = SLACK_LIMIT;
      chunks.push(remaining.slice(0, splitAt));
      remaining = remaining.slice(splitAt).trimStart();
    }
    for (const chunk of chunks) {
      if (chunk.trim()) {
        await withRetry(
          () =>
            slackApp.client.chat.postMessage({
              channel: channelId,
              text: chunk,
            }),
          retryOpts("chat.postMessage:channelProvider"),
        );
      }
    }
  },

  getBotUsername(): string {
    return botUsername || "unknown";
  },

  async sendNotification(
    channelId: string,
    payload: ChannelNotificationPayload,
    callbacks?: ChannelNotificationCallbacks,
  ): Promise<void> {
    if (payload.type !== "friend-request") {
      logger.warn({ msg: "SlackChannelProvider.sendNotification: unsupported payload type", type: payload.type });
      return;
    }
    if (!app) throw new Error("Slack app not initialized");
    const slackApp = app;

    const fromLabel = escapeMrkdwn(payload.from || payload.pubkey || "unknown peer");
    const text = `Friend request from *${fromLabel}*`;

    const blocks = [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text,
        },
      },
    ];

    if (callbacks) {
      const nonce = randomUUID();
      blocks.push({
        type: "actions",
        elements: [
          {
            type: "button",
            text: { type: "plain_text", text: "Accept" },
            style: "primary",
            action_id: "notification_accept",
            value: nonce,
          },
          {
            type: "button",
            text: { type: "plain_text", text: "Deny" },
            style: "danger",
            action_id: "notification_deny",
            value: nonce,
          },
        ],
      } as never);

      await withRetry(
        () =>
          slackApp.client.chat.postMessage({
            channel: channelId,
            text,
            // biome-ignore lint/suspicious/noExplicitAny: bolt block types require complex discriminated unions
            blocks: blocks as any,
          }),
        retryOpts("chat.postMessage:notification"),
      );

      pendingNotifications.set(nonce, { callbacks, channelId, createdAt: Date.now() });
    } else {
      await withRetry(
        () =>
          slackApp.client.chat.postMessage({
            channel: channelId,
            text,
            // biome-ignore lint/suspicious/noExplicitAny: bolt block types require complex discriminated unions
            blocks: blocks as any,
          }),
        retryOpts("chat.postMessage:notification"),
      );
    }
  },
};

// ============================================================================
// Extension API (for cross-plugin and CLI access)
// ============================================================================

const slackExtension = {
  getBotUsername: () => botUsername || "unknown",

  claimOwnership: async (
    code: string,
    sourceId?: string,
    claimingUserId?: string,
  ): Promise<{
    success: boolean;
    userId?: string;
    username?: string;
    error?: string;
  }> => {
    if (!ctx) return { success: false, error: "Slack plugin not initialized" };

    const result = claimPairingCode(code, sourceId, claimingUserId);
    if (!result.request) {
      return {
        success: false,
        error: result.error || "Invalid or expired pairing code",
      };
    }

    try {
      await approveUser(ctx, result.request.slackUserId);
    } catch (error: unknown) {
      return {
        success: false,
        error: `Failed to approve user: ${error instanceof Error ? error.message : String(error)}`,
      };
    }

    return {
      success: true,
      userId: result.request.slackUserId,
      username: result.request.slackUsername,
    };
  },
};

// Store bot username and token for ChannelProvider and file downloads
let botUsername = "";
let storedBotToken = "";

// Config schema for WebUI
const configSchema: ConfigSchema = {
  title: "Slack Integration",
  description: "Configure Slack bot integration",
  fields: [
    {
      name: "mode",
      type: "select",
      label: "Connection Mode",
      options: [
        { value: "socket", label: "Socket Mode (recommended)" },
        { value: "http", label: "HTTP Webhooks" },
      ],
      default: "socket",
      description: "Socket Mode works through firewalls, HTTP requires public URL",
      setupFlow: "none",
    },
    {
      name: "botToken",
      type: "password",
      label: "Bot Token",
      placeholder: "xoxb-...",
      required: true,
      description: "Bot User OAuth Token from Slack",
      secret: true,
      setupFlow: "paste",
    },
    {
      name: "appToken",
      type: "password",
      label: "App Token",
      placeholder: "xapp-...",
      description: "Required for Socket Mode (App-Level Token with connections:write)",
      secret: true,
      setupFlow: "paste",
    },
    {
      name: "signingSecret",
      type: "password",
      label: "Signing Secret",
      placeholder: "...",
      description: "Required for HTTP mode (from Slack App Basic Info)",
      secret: true,
      setupFlow: "paste",
    },
    {
      name: "clientId",
      type: "password",
      label: "Client ID",
      placeholder: "...",
      description: "OAuth Client ID for automatic token rotation (granular permissions)",
      secret: true,
      setupFlow: "paste",
    },
    {
      name: "clientSecret",
      type: "password",
      label: "Client Secret",
      placeholder: "...",
      description: "OAuth Client Secret for automatic token rotation (granular permissions)",
      secret: true,
      setupFlow: "paste",
    },
    {
      name: "stateSecret",
      type: "password",
      label: "State Secret",
      placeholder: "...",
      description: "Secret for OAuth state verification (any random string)",
      secret: true,
      setupFlow: "paste",
    },
    {
      name: "ackReaction",
      type: "text",
      label: "Ack Reaction Emoji",
      placeholder: "👀",
      default: "👀",
      description: "Emoji to react with while processing",
      setupFlow: "none",
    },
    {
      name: "replyToMode",
      type: "select",
      label: "Reply Threading",
      options: [
        { value: "off", label: "Reply in channel" },
        { value: "first", label: "First reply in thread" },
        { value: "all", label: "All replies in thread" },
      ],
      default: "off",
      description: "Control automatic threading of replies",
      setupFlow: "none",
    },
    {
      name: "dmPolicy",
      type: "select",
      label: "DM Policy",
      options: [
        { value: "pairing", label: "Pairing (approve unknown users)" },
        { value: "open", label: "Open (accept all DMs)" },
        { value: "closed", label: "Closed (ignore DMs)" },
      ],
      default: "pairing",
      description: "How to handle direct messages from unknown users",
      setupFlow: "none",
    },
    {
      name: "enabled",
      type: "checkbox",
      label: "Enabled",
      default: true,
      setupFlow: "none",
    },
    {
      name: "retryMaxRetries",
      type: "text",
      label: "Max Retries",
      placeholder: "3",
      default: "3",
      description: "Maximum number of retries for rate-limited API calls",
      setupFlow: "none",
    },
    {
      name: "retryBaseDelay",
      type: "text",
      label: "Retry Base Delay (ms)",
      placeholder: "1000",
      default: "1000",
      description: "Base delay in milliseconds for exponential backoff",
      setupFlow: "none",
    },
    {
      name: "retryMaxDelay",
      type: "text",
      label: "Retry Max Delay (ms)",
      placeholder: "30000",
      default: "30000",
      description: "Maximum delay in milliseconds between retries",
      setupFlow: "none",
    },
  ],
};

// Discord limit is 2000, Slack is 4000
const SLACK_LIMIT = 4000;

/**
 * Refresh agent identity from workspace
 */
async function refreshIdentity() {
  if (!ctx) return;
  try {
    const identity = await ctx.getAgentIdentity();
    if (identity) {
      agentIdentity = { ...agentIdentity, ...identity };
      logger.info({ msg: "Identity refreshed", identity: agentIdentity });
    }
  } catch (error: unknown) {
    logger.warn({ msg: "Failed to refresh identity", error: String(error) });
  }
}

const plugin: WOPRPlugin = {
  name: "wopr-plugin-slack",
  version: "1.0.0",
  description: "Slack integration with Socket Mode and HTTP webhook support",

  manifest: {
    name: "wopr-plugin-slack",
    version: "1.0.0",
    description: "Slack integration with Socket Mode and HTTP webhook support",
    capabilities: ["channel"],
    category: "channel",
    tags: ["slack", "chat", "messaging", "channel"],
    icon: ":speech_balloon:",
    requires: {},
    provides: {
      capabilities: [
        {
          type: "channel",
          id: "slack",
          displayName: "Slack",
        },
      ],
    },
    lifecycle: {
      shutdownBehavior: "graceful",
    },
    configSchema: {
      title: "Slack Integration",
      description: "Configure Slack bot integration",
      fields: configSchema.fields,
    },
  },

  commands: [
    {
      name: "slack",
      description: "Slack plugin commands",
      usage: "wopr slack claim <code>",
      async handler(_context: WOPRPluginContext, args: string[]) {
        const [subcommand, ...rest] = args;

        if (subcommand === "claim") {
          const code = rest[0];
          if (!code) {
            process.exit(1);
          }

          try {
            const response = await fetch("http://localhost:7437/plugins/slack/claim", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ code }),
            });
            const result = (await response.json()) as {
              success?: boolean;
              userId?: string;
              username?: string;
              error?: string;
            };

            if (result.success) {
              process.exit(0);
            } else {
              process.exit(1);
            }
          } catch (_error: unknown) {
            process.exit(1);
          }
        } else {
          process.exit(subcommand ? 1 : 0);
        }
      },
    },
  ],

  async init(context: WOPRPluginContext) {
    ctx = context;
    if (ctx.registerConfigSchema) {
      ctx.registerConfigSchema("wopr-plugin-slack", configSchema);
      cleanups.push(() => ctx?.unregisterConfigSchema?.("wopr-plugin-slack"));
    }

    // Register as a channel provider so other plugins can add commands/parsers
    ctx.registerChannelProvider(slackChannelProvider as import("@wopr-network/plugin-types").ChannelProvider);
    logger.info("Registered Slack channel provider");
    cleanups.push(() => ctx?.unregisterChannelProvider("slack"));

    // Register the Slack extension so other plugins can interact with Slack
    ctx.registerExtension("slack", slackExtension);
    logger.info("Registered Slack extension");
    cleanups.push(() => ctx?.unregisterExtension("slack"));

    // Load agent identity
    await refreshIdentity();

    // Get config - config is stored directly on the plugin, not nested under channels
    const fullConfig = ctx.getConfig<{ channels?: { slack?: SlackConfig } }>();
    let config: SlackConfig = fullConfig?.channels?.slack || {};

    // Check env vars as fallback
    if (!config.botToken && process.env.SLACK_BOT_TOKEN) {
      config = {
        ...config,
        botToken: process.env.SLACK_BOT_TOKEN,
      };
    }
    if (!config.appToken && process.env.SLACK_APP_TOKEN) {
      config = {
        ...config,
        appToken: process.env.SLACK_APP_TOKEN,
      };
    }
    if (!config.clientId && process.env.SLACK_CLIENT_ID) {
      config = { ...config, clientId: process.env.SLACK_CLIENT_ID };
    }
    if (!config.clientSecret && process.env.SLACK_CLIENT_SECRET) {
      config = { ...config, clientSecret: process.env.SLACK_CLIENT_SECRET };
    }
    if (!config.stateSecret && process.env.SLACK_STATE_SECRET) {
      config = { ...config, stateSecret: process.env.SLACK_STATE_SECRET };
    }

    // Load retry config — the WebUI schema exposes flat fields (retryMaxRetries,
    // retryBaseDelay, retryMaxDelay) while SlackConfig types them as a nested
    // `retry` object. Merge both so either config source works.
    const rawConfig = config as Record<string, unknown>;
    const flatRetry: RetryConfig = {
      ...(rawConfig.retryMaxRetries != null && {
        maxRetries: Number(rawConfig.retryMaxRetries),
      }),
      ...(rawConfig.retryBaseDelay != null && {
        baseDelay: Number(rawConfig.retryBaseDelay),
      }),
      ...(rawConfig.retryMaxDelay != null && {
        maxDelay: Number(rawConfig.retryMaxDelay),
      }),
    };
    retryConfig = { ...flatRetry, ...config.retry };

    if (!config.enabled) {
      logger.info("Slack plugin disabled in config");
      return;
    }

    if (!config.botToken) {
      logger.warn("Slack bot token not configured. Set SLACK_BOT_TOKEN or config.channels.slack.botToken");
      return;
    }

    // Initialize Slack app
    try {
      app = await initSlackApp(config, logger);
      const slackApp = app;

      // Store bot user ID for mention detection
      const authTest = await withRetry(() => slackApp.client.auth.test(), retryOpts("auth.test"));
      const botUserId = authTest.user_id;
      botUsername = (authTest.user as string) || "";
      storedBotToken = config.botToken || "";

      // Build deps for message handler (getters to avoid circular refs)
      const msgDeps: MessageHandlerDeps = {
        getApp: () => app,
        getCtx: () => ctx,
        getStoredBotToken: () => storedBotToken,
        retryOpts,
        logger,
        agentIdentity,
      };

      // Message handler
      slackApp.message(async ({ message, context, say }) => {
        const hasText = "text" in message && !!message.text;
        const msgRecord = message as unknown as Record<string, unknown>;
        const hasFiles =
          "files" in message && Array.isArray(msgRecord.files) && (msgRecord.files as unknown[]).length > 0;

        // Skip messages with neither text nor files
        if (!hasText && !hasFiles) return;

        // Add bot user ID to context — Context extends StringIndexed so this is valid
        context.botUserId = botUserId;

        await handleMessage(msgRecord, context, say, config, msgDeps);
      });

      // App mention handler
      slackApp.event("app_mention", async ({ event, context, say }) => {
        await handleMessage(
          event as unknown as Record<string, unknown>,
          { ...context, channel: event.channel },
          say,
          config,
          msgDeps,
        );
      });

      // Register action handlers for friend request notifications
      slackApp.action("notification_accept", async ({ ack, body }) => {
        await ack();
        const nonce = (body as unknown as { actions?: Array<{ value?: string }> }).actions?.[0]?.value;
        const incomingChannelId = (body as unknown as { channel?: { id?: string } }).channel?.id;
        if (!nonce) return;
        const pending = pendingNotifications.get(nonce);
        if (pending) {
          if (incomingChannelId && pending.channelId !== incomingChannelId) return;
          pendingNotifications.delete(nonce);
          try {
            await pending.callbacks.onAccept?.();
          } catch (error: unknown) {
            logger.error({ msg: "Error in notification_accept callback", error: String(error) });
          }
        }
      });

      slackApp.action("notification_deny", async ({ ack, body }) => {
        await ack();
        const nonce = (body as unknown as { actions?: Array<{ value?: string }> }).actions?.[0]?.value;
        const incomingChannelId = (body as unknown as { channel?: { id?: string } }).channel?.id;
        if (!nonce) return;
        const pending = pendingNotifications.get(nonce);
        if (pending) {
          if (incomingChannelId && pending.channelId !== incomingChannelId) return;
          pendingNotifications.delete(nonce);
          try {
            await pending.callbacks.onDeny?.();
          } catch (error: unknown) {
            logger.error({ msg: "Error in notification_deny callback", error: String(error) });
          }
        }
      });

      // Register slash commands
      registerSlashCommands(slackApp, () => ctx);

      // Start periodic cleanup of expired pairing codes and stale notifications
      cleanupTimer = setInterval(
        () => {
          cleanupExpiredPairings();
          const now = Date.now();
          for (const [nonce, pending] of pendingNotifications) {
            if (now - pending.createdAt > NOTIFICATION_TTL_MS) {
              pendingNotifications.delete(nonce);
            }
          }
        },
        5 * 60 * 1000,
      );
      cleanups.push(() => {
        if (cleanupTimer) {
          clearInterval(cleanupTimer);
          cleanupTimer = null;
        }
      });

      // Start the app
      const mode = config.mode || "socket";
      if (mode === "socket") {
        await slackApp.start();
        logger.info("Slack Socket Mode started");
      } else {
        // HTTP mode - app is started by Express/Hono server elsewhere
        logger.info("Slack HTTP mode configured");
      }
    } catch (error: unknown) {
      logger.error({
        msg: "Failed to initialize Slack app",
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  },

  async shutdown() {
    stopAllTyping();
    pendingNotifications.clear();
    if (!ctx) return;
    for (const fn of cleanups) {
      try {
        await fn();
      } catch (error: unknown) {
        logger.warn({
          msg: "Cleanup error during shutdown",
          error: String(error),
        });
      }
    }
    cleanups.length = 0;
    if (app) {
      await app.stop();
      app = null;
      logger.info("Slack plugin stopped");
    }
    ctx = null;
  },
};

export default plugin;
