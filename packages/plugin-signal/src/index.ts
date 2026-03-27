/**
 * WOPR Signal Plugin - signal-cli integration
 */

import crypto from "node:crypto";
import path from "node:path";
import type {
  AgentIdentity,
  ChannelCommand,
  ChannelCommandContext,
  ChannelMessageContext,
  ChannelMessageParser,
  ChannelProvider,
  ChannelRef,
  ConfigSchema,
  PluginManifest,
  WOPRPlugin,
  WOPRPluginContext,
} from "@wopr-network/plugin-types";
import winston from "winston";
import { type SignalEvent, signalCheck, signalRpcRequest, streamSignalEvents } from "./client.js";
import { type SignalDaemonHandle, spawnSignalDaemon, waitForSignalDaemonReady } from "./daemon.js";
import { getWebMCPHandlers, initWebMCP, teardownWebMCP, webmcpToolDeclarations } from "./webmcp.js";

// Notification types (local until plugin-types exports them)
interface ChannelNotificationPayload {
  type: string;
  from?: string;
  pubkey?: string;
  [key: string]: unknown;
}

interface ChannelNotificationCallbacks {
  onAccept?: () => Promise<void>;
  onDeny?: () => Promise<void>;
}

interface PendingNotification {
  channelId: string;
  payload: ChannelNotificationPayload;
  callbacks: ChannelNotificationCallbacks;
}

// Signal message types
interface SignalMessage {
  id: string;
  from: string;
  fromMe: boolean;
  timestamp: number;
  text?: string;
  isGroup: boolean;
  groupId?: string;
  groupName?: string;
  sender?: string;
  senderNumber?: string;
  senderUuid?: string;
  attachments?: Array<{
    id: string;
    contentType?: string;
    filename?: string;
    size?: number;
  }>;
  quote?: {
    text?: string;
    author?: string;
  };
}

interface SignalConfig {
  account?: string;
  cliPath?: string;
  httpHost?: string;
  httpPort?: number;
  httpUrl?: string;
  autoStart?: boolean;
  dmPolicy?: "allowlist" | "pairing" | "open" | "disabled";
  allowFrom?: string[];
  groupAllowFrom?: string[];
  groupPolicy?: "allowlist" | "open" | "disabled";
  mediaMaxMb?: number;
  ignoreAttachments?: boolean;
  ignoreStories?: boolean;
  sendReadReceipts?: boolean;
  receiveMode?: "native" | "manually";
}

// Module-level state
let ctx: WOPRPluginContext | null = null;
let config: SignalConfig = {};
let agentIdentity: AgentIdentity = { name: "WOPR", emoji: "👀" };
let daemonHandle: SignalDaemonHandle | null = null;
let abortController: AbortController | null = null;
const messageCache: Map<string, SignalMessage> = new Map();
let sseRetryTimeout: NodeJS.Timeout | null = null;
let isShuttingDown = false;
let logger: winston.Logger;
const pendingNotifications: Map<string, PendingNotification> = new Map();
let notificationCleanupTimer: NodeJS.Timeout | null = null;

// ============================================================================
// Channel Provider — allows other plugins to register commands and parsers
// ============================================================================

const registeredCommands: Map<string, ChannelCommand> = new Map();
const registeredParsers: Map<string, ChannelMessageParser> = new Map();

const signalChannelProvider: ChannelProvider = {
  id: "signal",

  registerCommand(cmd: ChannelCommand): void {
    registeredCommands.set(cmd.name.toLowerCase(), cmd);
  },

  unregisterCommand(name: string): void {
    registeredCommands.delete(name.toLowerCase());
  },

  getCommands(): ChannelCommand[] {
    return Array.from(registeredCommands.values());
  },

  addMessageParser(parser: ChannelMessageParser): void {
    registeredParsers.set(parser.id, parser);
  },

  removeMessageParser(id: string): void {
    registeredParsers.delete(id);
  },

  getMessageParsers(): ChannelMessageParser[] {
    return Array.from(registeredParsers.values());
  },

  async send(channel: string, content: string): Promise<void> {
    await sendMessageInternal(channel, content);
  },

  getBotUsername(): string {
    return config.account || "signal-bot";
  },
};

// Initialize winston logger
function initLogger(): winston.Logger {
  const WOPR_HOME = process.env.WOPR_HOME || path.join(process.env.HOME || "~", ".wopr");
  return winston.createLogger({
    level: "debug",
    format: winston.format.combine(
      winston.format.timestamp(),
      winston.format.errors({ stack: true }),
      winston.format.json(),
    ),
    defaultMeta: { service: "wopr-plugin-signal" },
    transports: [
      new winston.transports.File({
        filename: path.join(WOPR_HOME, "logs", "signal-plugin-error.log"),
        level: "error",
      }),
      new winston.transports.File({
        filename: path.join(WOPR_HOME, "logs", "signal-plugin.log"),
        level: "debug",
      }),
      new winston.transports.Console({
        format: winston.format.combine(winston.format.colorize(), winston.format.simple()),
        level: "warn",
      }),
    ],
  });
}

// Config schema for the plugin
const configSchema: ConfigSchema = {
  title: "Signal Integration",
  description: "Configure Signal integration using signal-cli",
  fields: [
    {
      name: "account",
      type: "text",
      label: "Signal Account",
      placeholder: "+1234567890",
      description: "Your Signal phone number (E.164 format)",
    },
    {
      name: "cliPath",
      type: "text",
      label: "signal-cli Path",
      placeholder: "signal-cli",
      default: "signal-cli",
      description: "Path to signal-cli executable",
    },
    {
      name: "httpHost",
      type: "text",
      label: "HTTP Host",
      placeholder: "127.0.0.1",
      default: "127.0.0.1",
      description: "Host for signal-cli HTTP daemon",
    },
    {
      name: "httpPort",
      type: "number",
      label: "HTTP Port",
      placeholder: "8080",
      default: 8080,
      description: "Port for signal-cli HTTP daemon",
    },
    {
      name: "autoStart",
      type: "boolean",
      label: "Auto-start Daemon",
      default: true,
      description: "Automatically start signal-cli daemon",
    },
    {
      name: "dmPolicy",
      type: "select",
      label: "DM Policy",
      placeholder: "pairing",
      default: "pairing",
      description: "How to handle direct messages",
    },
    {
      name: "allowFrom",
      type: "array",
      label: "Allowed Senders",
      placeholder: "+1234567890, uuid:xxx",
      description: "Phone numbers or UUIDs allowed to DM",
    },
    {
      name: "groupPolicy",
      type: "select",
      label: "Group Policy",
      placeholder: "allowlist",
      default: "allowlist",
      description: "How to handle group messages",
    },
    {
      name: "mediaMaxMb",
      type: "number",
      label: "Media Max Size (MB)",
      placeholder: "8",
      default: 8,
      description: "Maximum attachment size in MB",
    },
    {
      name: "ignoreAttachments",
      type: "boolean",
      label: "Ignore Attachments",
      default: false,
      description: "Don't download attachments",
    },
    {
      name: "sendReadReceipts",
      type: "boolean",
      label: "Send Read Receipts",
      default: false,
      description: "Send read receipts for incoming messages",
    },
  ],
};

// ============================================================================
// Plugin Manifest
// ============================================================================

const pluginManifest: PluginManifest & {
  webmcpTools?: typeof webmcpToolDeclarations;
} = {
  name: "@wopr-network/plugin-signal",
  version: "1.0.0",
  description: "Signal integration using signal-cli",
  capabilities: ["channel"],
  category: "channel",
  tags: ["signal", "messaging", "channel"],
  icon: "\uD83D\uDCF1",
  requires: {
    bins: ["signal-cli"],
    network: { outbound: true },
  },
  provides: {
    capabilities: [
      {
        type: "channel",
        id: "signal",
        displayName: "Signal Messenger",
      },
    ],
  },
  lifecycle: { shutdownBehavior: "graceful" as const },
  configSchema,
  webmcpTools: webmcpToolDeclarations,
};

// Refresh identity from workspace
async function refreshIdentity(): Promise<void> {
  if (!ctx) return;
  try {
    const identity = await ctx.getAgentIdentity();
    if (identity) {
      agentIdentity = { ...agentIdentity, ...identity };
      logger.info("Identity refreshed:", agentIdentity.name);
    }
  } catch (error: unknown) {
    logger.warn("Failed to refresh identity:", String(error));
  }
}

function _getAckReaction(): string {
  return agentIdentity.emoji?.trim() || "👀";
}

function getBaseUrl(): string {
  if (config.httpUrl) return config.httpUrl;
  const host = config.httpHost || "127.0.0.1";
  const port = config.httpPort || 8080;
  return `http://${host}:${port}`;
}

function normalizeE164(phone: string): string | null {
  const cleaned = phone.replace(/[^0-9+]/g, "");
  if (!/^\+?[0-9]+$/.test(cleaned)) return null;
  return cleaned.startsWith("+") ? cleaned : `+${cleaned}`;
}

function isAllowed(sender: string, isGroup: boolean): boolean {
  if (isGroup) {
    const policy = config.groupPolicy || "allowlist";
    if (policy === "open") return true;
    if (policy === "disabled") return false;

    const allowed = config.groupAllowFrom || config.allowFrom || [];
    if (allowed.includes("*")) return true;

    return allowed.some(
      (id) => id === sender || id === `uuid:${sender}` || normalizeE164(id) === normalizeE164(sender),
    );
  } else {
    const policy = config.dmPolicy || "pairing";
    if (policy === "open") return true;
    if (policy === "disabled") return false;
    if (policy === "pairing") {
      // In pairing mode, all unknown senders get a pairing request
      return true;
    }

    // allowlist mode
    const allowed = config.allowFrom || [];
    if (allowed.includes("*")) return true;

    return allowed.some(
      (id) => id === sender || id === `uuid:${sender}` || normalizeE164(id) === normalizeE164(sender),
    );
  }
}

function parseSignalEvent(event: SignalEvent): SignalMessage | null {
  if (!event.data) return null;

  try {
    const data = JSON.parse(event.data);

    // Only handle message events
    if (event.event !== "message") return null;

    const envelope = data.envelope;
    if (!envelope) return null;

    // Skip our own messages
    if (envelope.source === config.account) return null;

    const timestamp = envelope.timestamp || Date.now();
    const messageId = `${timestamp}-${envelope.source}`;

    let text = "";
    let attachments: SignalMessage["attachments"] = [];
    let quote: SignalMessage["quote"] | undefined;

    const dataMessage = envelope.dataMessage;
    if (dataMessage) {
      text = dataMessage.message || "";

      if (dataMessage.attachments) {
        attachments = dataMessage.attachments.map((att: any) => ({
          id: att.id,
          contentType: att.contentType,
          filename: att.filename,
          size: att.size,
        }));
      }

      if (dataMessage.quote) {
        quote = {
          text: dataMessage.quote.text,
          author: dataMessage.quote.author,
        };
      }
    }

    const syncMessage = envelope.syncMessage;
    if (syncMessage?.sentMessage) {
      // This is a sync of our own sent message, skip
      return null;
    }

    const isGroup = Boolean(dataMessage?.groupInfo?.groupId);
    const groupId = dataMessage?.groupInfo?.groupId;

    return {
      id: messageId,
      from: envelope.source,
      fromMe: false,
      timestamp,
      text,
      isGroup,
      groupId,
      sender: envelope.sourceName || envelope.source,
      senderNumber: envelope.sourceNumber,
      senderUuid: envelope.sourceUuid,
      attachments,
      quote,
    };
  } catch (error: unknown) {
    logger.error("Failed to parse Signal event:", error instanceof Error ? error.message : String(error));
    return null;
  }
}

async function handleIncomingMessage(msg: SignalMessage): Promise<void> {
  if (!ctx) return;

  // Check if sender is allowed
  if (!isAllowed(msg.from, msg.isGroup)) {
    logger.info(`Message from ${msg.from} blocked by policy`);
    return;
  }

  // Build channel info
  const channelId = msg.isGroup && msg.groupId ? `group:${msg.groupId}` : msg.from;
  const channelInfo: ChannelRef = {
    type: "signal",
    id: channelId,
    name: msg.isGroup ? "Signal Group" : "Signal DM",
  };

  // Emit channel:message event for other plugins
  if (ctx.events) {
    ctx.events
      .emit("channel:message", {
        channel: { type: "signal", id: channelId, name: channelInfo.name },
        message: msg.text || "[media]",
        from: msg.sender || msg.from,
      })
      .catch((error: unknown) => {
        logger.error("Failed to emit channel:message event:", error instanceof Error ? error.message : String(error));
      });
  }

  const text = msg.text || "";

  // Check registered channel commands (e.g., !command args)
  if (text.startsWith("!")) {
    const parts = text.slice(1).split(/\s+/);
    const cmdName = parts[0]?.toLowerCase();
    const cmd = cmdName ? registeredCommands.get(cmdName) : undefined;
    if (cmd) {
      const cmdCtx: ChannelCommandContext = {
        channel: channelId,
        channelType: "signal",
        sender: msg.sender || msg.from,
        args: parts.slice(1),
        reply: (reply: string) => sendMessageInternal(channelId, reply),
        getBotUsername: () => config.account || "signal-bot",
      };
      try {
        await cmd.handler(cmdCtx);
      } catch (error: unknown) {
        logger.error(`Command handler '${cmdName}' threw:`, error instanceof Error ? error.message : String(error));
      }
      return;
    }
  }

  // Run registered message parsers
  for (const parser of registeredParsers.values()) {
    let matches = false;
    try {
      matches = typeof parser.pattern === "function" ? parser.pattern(text) : parser.pattern.test(text);
    } catch (error: unknown) {
      logger.error(`Parser '${parser.id}' pattern threw:`, error instanceof Error ? error.message : String(error));
      continue;
    }
    if (matches) {
      const parserCtx: ChannelMessageContext = {
        channel: channelId,
        channelType: "signal",
        sender: msg.sender || msg.from,
        content: text,
        reply: (reply: string) => sendMessageInternal(channelId, reply),
        getBotUsername: () => config.account || "signal-bot",
      };
      try {
        await parser.handler(parserCtx);
      } catch (error: unknown) {
        logger.error(`Parser '${parser.id}' handler threw:`, error instanceof Error ? error.message : String(error));
      }
      return;
    }
  }

  // Log for context
  const logOptions = {
    from: msg.sender || msg.from,
    channel: channelInfo,
  };

  const sessionKey = `signal-${channelId}`;
  ctx.logMessage(sessionKey, msg.text || "[media]", logOptions);

  // Cache message for reaction handling
  messageCache.set(msg.id, msg);

  // Inject to WOPR
  await injectMessage(msg, sessionKey);
}

async function injectMessage(signalMsg: SignalMessage, sessionKey: string): Promise<void> {
  if (!ctx || !signalMsg.text) return;

  const prefix = `[${signalMsg.sender || "Signal User"}]: `;
  const messageWithPrefix = prefix + signalMsg.text;

  const channelInfo: ChannelRef = {
    type: "signal",
    id: signalMsg.isGroup && signalMsg.groupId ? `group:${signalMsg.groupId}` : signalMsg.from,
    name: signalMsg.isGroup ? "Signal Group" : "Signal DM",
  };

  const response = await ctx.inject(sessionKey, messageWithPrefix, {
    from: signalMsg.sender || signalMsg.from,
    channel: channelInfo,
  });

  // Send response
  const target = signalMsg.isGroup && signalMsg.groupId ? `group:${signalMsg.groupId}` : signalMsg.from;

  await sendMessageInternal(target, response);
}

async function sendMessageInternal(to: string, text: string, opts?: { mediaUrl?: string }): Promise<void> {
  const baseUrl = getBaseUrl();
  const account = config.account;

  // Parse target
  let targetType: "recipient" | "group" = "recipient";
  let recipient: string | undefined;
  let groupId: string | undefined;

  if (to.toLowerCase().startsWith("group:")) {
    targetType = "group";
    groupId = to.slice(6);
  } else {
    recipient = to;
  }

  // Build params
  const params: Record<string, any> = {
    message: text,
  };

  if (account) params.account = account;
  if (targetType === "group") {
    params.groupId = groupId;
  } else {
    params.recipient = [recipient];
  }

  if (opts?.mediaUrl) {
    params.attachments = [opts.mediaUrl];
  }

  await signalRpcRequest("send", params, { baseUrl });
}

async function runSseLoop(): Promise<void> {
  if (isShuttingDown) return;

  const baseUrl = getBaseUrl();
  abortController = new AbortController();

  try {
    logger.info("Starting Signal SSE stream...");

    await streamSignalEvents({
      baseUrl,
      account: config.account,
      abortSignal: abortController.signal,
      onEvent: (event) => {
        const msg = parseSignalEvent(event);
        if (msg) {
          handleIncomingMessage(msg).catch((error: unknown) => {
            logger.error("Error handling Signal message:", error instanceof Error ? error.message : String(error));
          });
        }
      },
    });
  } catch (error: unknown) {
    if (isShuttingDown) return;

    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error("Signal SSE error:", errorMsg);

    // Retry with exponential backoff
    const retryDelay = Math.min(5000 * 2 ** (sseRetryTimeout ? 1 : 0), 30000);
    logger.info(`Retrying SSE connection in ${retryDelay}ms...`);

    sseRetryTimeout = setTimeout(() => {
      if (!isShuttingDown) {
        runSseLoop().catch((error: unknown) => {
          logger.error("Fatal SSE loop error:", error instanceof Error ? error.message : String(error));
        });
      }
    }, retryDelay);
  }
}

async function startSignal(): Promise<void> {
  const baseUrl = getBaseUrl();

  // Check if already running
  const check = await signalCheck(baseUrl, 2000);
  if (check.ok) {
    logger.info("Signal daemon already running");
    await runSseLoop();
    return;
  }

  // Auto-start if enabled
  if (config.autoStart !== false) {
    logger.info("Starting Signal daemon...");

    daemonHandle = spawnSignalDaemon({
      cliPath: config.cliPath || "signal-cli",
      account: config.account,
      httpHost: config.httpHost || "127.0.0.1",
      httpPort: config.httpPort || 8080,
      receiveMode: config.receiveMode,
      ignoreAttachments: config.ignoreAttachments,
      ignoreStories: config.ignoreStories,
      sendReadReceipts: config.sendReadReceipts,
      runtime: {
        log: (msg) => logger.info(msg),
        error: (msg) => logger.error(msg),
      },
    });

    logger.info(`Signal daemon started (PID: ${daemonHandle.pid})`);

    // Wait for daemon to be ready
    await waitForSignalDaemonReady(baseUrl, 30000, {
      log: (msg) => logger.info(msg),
      error: (msg) => logger.error(msg),
    });

    // Start SSE loop
    await runSseLoop();
  } else {
    logger.error("Signal daemon not running and auto-start disabled. Please start signal-cli manually.");
    throw new Error("Signal daemon not available");
  }
}

// ============================================================================
// Notification support — sendNotification for channel provider
// ============================================================================

const NOTIFICATION_TTL_MS = 5 * 60 * 1000; // 5 minutes

async function sendNotification(
  channelId: string,
  payload: ChannelNotificationPayload,
  callbacks: ChannelNotificationCallbacks,
): Promise<void> {
  if (payload.type !== "friend-request") {
    throw new Error(`Unsupported notification type: ${payload.type}`);
  }

  const ownerPhone = config.account;
  if (!ownerPhone) {
    throw new Error("Cannot send notification: no Signal account (ownerPhone) configured");
  }

  const notifId = crypto.randomUUID().slice(0, 8);
  const fromLabel = payload.from || "unknown";

  pendingNotifications.set(notifId, { channelId, payload, callbacks });

  // Send DM to the bot owner
  await sendMessageInternal(
    ownerPhone,
    `Friend request from ${fromLabel}. Reply ACCEPT ${notifId} or DENY ${notifId}.`,
  );

  // Register a message parser scoped to ownerPhone sender
  const parserId = `notif-${crypto.randomUUID()}`;
  const parser: ChannelMessageParser = {
    id: parserId,
    pattern: (text: string) => {
      const trimmed = text.trim();
      return (
        trimmed.toLowerCase() === `accept ${notifId}`.toLowerCase() ||
        trimmed.toLowerCase() === `deny ${notifId}`.toLowerCase()
      );
    },
    handler: async (msgCtx: ChannelMessageContext) => {
      // Only accept responses from the owner
      if (msgCtx.sender !== ownerPhone) return;

      const lower = msgCtx.content.trim().toLowerCase();
      const pending = pendingNotifications.get(notifId);
      if (!pending) return;

      try {
        if (lower === `accept ${notifId}`.toLowerCase() && pending.callbacks.onAccept) {
          await pending.callbacks.onAccept();
          await msgCtx.reply("Accepted.");
        } else if (lower === `deny ${notifId}`.toLowerCase() && pending.callbacks.onDeny) {
          await pending.callbacks.onDeny();
          await msgCtx.reply("Denied.");
        }
      } finally {
        pendingNotifications.delete(notifId);
        signalChannelProvider.removeMessageParser(parserId);
      }
    },
  };

  signalChannelProvider.addMessageParser(parser);

  // TTL: auto-remove after 5 minutes
  const ttlTimeout = setTimeout(() => {
    if (pendingNotifications.has(notifId)) {
      pendingNotifications.delete(notifId);
      signalChannelProvider.removeMessageParser(parserId);
      logger?.info(`Notification ${notifId} expired (TTL)`);
    }
  }, NOTIFICATION_TTL_MS);
  // Don't block shutdown
  ttlTimeout.unref?.();
}

// Plugin definition
const plugin: WOPRPlugin = {
  name: "signal",
  version: "1.0.0",
  description: "Signal integration using signal-cli",
  manifest: pluginManifest,

  async init(context: WOPRPluginContext): Promise<void> {
    ctx = context;
    config = (context.getConfig() || {}) as SignalConfig;

    // Initialize logger
    logger = initLogger();

    // Register config schema
    ctx.registerConfigSchema("signal", configSchema);

    // Register as a channel provider so other plugins can add commands/parsers
    ctx.registerChannelProvider(signalChannelProvider);

    // Initialize WebMCP tools with read-only access to plugin state
    initWebMCP({
      getBaseUrl,
      getAccount: () => config.account,
      getMessageCache: () => messageCache,
      isConnected: () => !isShuttingDown && abortController !== null,
    });

    // Refresh identity
    await refreshIdentity();

    // Validate config
    if (!config.account) {
      logger.warn("No Signal account configured. Run 'wopr configure --plugin signal' to set up.");
      return;
    }

    // Start Signal
    try {
      await startSignal();
    } catch (error: unknown) {
      logger.error("Failed to start Signal:", error instanceof Error ? error.message : String(error));
      // Don't throw - let plugin load but log the error
    }
  },

  async shutdown(): Promise<void> {
    if (!ctx) return;
    isShuttingDown = true;

    // Teardown WebMCP tools
    teardownWebMCP();

    // Unregister config schema
    if (ctx.unregisterConfigSchema) ctx.unregisterConfigSchema("signal");

    // Unregister channel provider
    ctx.unregisterChannelProvider(signalChannelProvider.id);

    // Clear registered commands and parsers
    registeredCommands.clear();
    registeredParsers.clear();

    // Clear pending notifications
    pendingNotifications.clear();
    if (notificationCleanupTimer) {
      clearInterval(notificationCleanupTimer);
      notificationCleanupTimer = null;
    }

    if (sseRetryTimeout) {
      clearTimeout(sseRetryTimeout);
      sseRetryTimeout = null;
    }

    if (abortController) {
      abortController.abort();
      abortController = null;
    }

    if (daemonHandle) {
      logger?.info("Stopping Signal daemon...");
      daemonHandle.stop();
      daemonHandle = null;
    }

    ctx = null;
    isShuttingDown = false;
  },
};

// Named exports for testing
export {
  normalizeE164,
  parseSignalEvent,
  configSchema,
  signalChannelProvider,
  pluginManifest,
  getWebMCPHandlers,
  sendNotification,
};
export type { SignalConfig, SignalMessage };

export default plugin;
