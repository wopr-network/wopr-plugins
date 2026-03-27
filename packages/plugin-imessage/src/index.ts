/**
 * WOPR iMessage Plugin
 *
 * iMessage/SMS integration for macOS using the imsg CLI tool.
 *
 * Requirements:
 * - macOS with Messages.app signed in
 * - imsg CLI: brew install steipete/tap/imsg
 * - Full Disk Access permission for WOPR
 * - Automation permission for Messages.app
 */

import { IMessageClient } from "./imsg-client.js";
import { logger } from "./logger.js";
import { buildPairingMessage, cleanupExpiredPairings, createPairingRequest } from "./pairing.js";
import type {
  AgentIdentity,
  ConfigSchema,
  IMessageConfig,
  IncomingMessage,
  WOPRPlugin,
  WOPRPluginContext,
} from "./types.js";

let client: IMessageClient | null = null;
let ctx: WOPRPluginContext | null = null;
let agentIdentity: AgentIdentity = { name: "WOPR", emoji: "👀" };
const messageQueue: Array<{ msg: IncomingMessage; receivedAt: number }> = [];
let processingInterval: NodeJS.Timeout | null = null;
let cleanupInterval: NodeJS.Timeout | null = null;

// Config schema for WebUI
const configSchema: ConfigSchema = {
  title: "iMessage Integration (macOS only)",
  description: "iMessage/SMS integration via imsg CLI. Requires macOS with Messages.app.",
  fields: [
    {
      name: "enabled",
      type: "checkbox",
      label: "Enabled",
      default: true,
    },
    {
      name: "cliPath",
      type: "text",
      label: "imsg CLI Path",
      placeholder: "/usr/local/bin/imsg",
      default: "imsg",
      description: "Path to imsg executable (install: brew install steipete/tap/imsg)",
    },
    {
      name: "dbPath",
      type: "text",
      label: "Messages DB Path",
      placeholder: "/Users/<you>/Library/Messages/chat.db",
      description: "Path to Messages database (usually auto-detected)",
    },
    {
      name: "service",
      type: "select",
      label: "Service",
      options: [
        { value: "auto", label: "Auto (iMessage preferred)" },
        { value: "imessage", label: "iMessage only" },
        { value: "sms", label: "SMS only" },
      ],
      default: "auto",
      description: "Which service to use for sending",
    },
    {
      name: "region",
      type: "text",
      label: "SMS Region",
      placeholder: "US",
      default: "US",
      description: "Region code for SMS formatting",
    },
    {
      name: "dmPolicy",
      type: "select",
      label: "DM Policy",
      options: [
        { value: "pairing", label: "Pairing (approve unknown contacts)" },
        { value: "allowlist", label: "Allowlist only" },
        { value: "open", label: "Open (accept all)" },
        { value: "closed", label: "Closed (ignore DMs)" },
      ],
      default: "pairing",
      description: "How to handle direct messages from unknown contacts",
    },
    {
      name: "groupPolicy",
      type: "select",
      label: "Group Policy",
      options: [
        { value: "allowlist", label: "Allowlist only" },
        { value: "open", label: "Open (all groups)" },
        { value: "disabled", label: "Disabled (ignore groups)" },
      ],
      default: "allowlist",
      description: "How to handle group messages",
    },
    {
      name: "includeAttachments",
      type: "checkbox",
      label: "Include Attachments",
      default: false,
      description: "Include image/file attachments in context (requires Full Disk Access)",
    },
    {
      name: "mediaMaxMb",
      type: "number",
      label: "Media Max Size (MB)",
      placeholder: "16",
      default: 16,
      description: "Maximum attachment size in MB",
    },
    {
      name: "textChunkLimit",
      type: "number",
      label: "Text Chunk Limit",
      placeholder: "4000",
      default: 4000,
      description: "Maximum characters per message (iMessage limit is high)",
    },
  ],
};

// iMessage chunk limit is very high (4000 default)
const IMESSAGE_CHUNK_LIMIT = 4000;

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
  } catch (e) {
    logger.warn({ msg: "Failed to refresh identity", error: String(e) });
  }
}

/**
 * Build session key from iMessage context
 */
function buildSessionKey(msg: IncomingMessage): string {
  if (msg.is_group) {
    return `imessage-group-${msg.chat_id || msg.chat_guid || msg.chat_identifier || "unknown"}`;
  }
  return `imessage-dm-${msg.sender || msg.handle || "unknown"}`;
}

/**
 * Determine if we should respond to this message
 */
function shouldRespond(msg: IncomingMessage, config: IMessageConfig): boolean | "pairing" {
  // Skip messages without text
  if (!msg.text?.trim()) {
    return false;
  }

  const isGroup = msg.is_group === true;
  const sender = msg.sender || msg.handle || "";

  // DM handling
  if (!isGroup) {
    const policy = config.dmPolicy || "pairing";
    if (policy === "closed") return false;
    if (policy === "open") return true;

    // Check allowlist
    const allowFrom = config.allowFrom || [];
    if (allowFrom.includes("*")) return true;
    if (sender && allowFrom.includes(sender)) return true;
    if (sender && allowFrom.some((a) => sender.includes(a))) return true;

    // Pairing mode: return "pairing" to signal the caller
    if (policy === "pairing") return "pairing";

    // Allowlist mode but not on list
    logger.info({
      msg: "Unapproved iMessage DM received (allowlist mode)",
      sender,
      text: msg.text?.substring(0, 100),
    });
    return false;
  }

  // Group handling
  const groupPolicy = config.groupPolicy || "allowlist";
  if (groupPolicy === "disabled") return false;
  if (groupPolicy === "open") return true;

  // Allowlist mode for groups
  const groupAllowFrom = config.groupAllowFrom || [];
  if (groupAllowFrom.includes("*")) return true;
  if (sender && groupAllowFrom.includes(sender)) return true;

  return false;
}

/**
 * Handle incoming iMessage
 */
async function handleIncomingMessage(msg: IncomingMessage, config: IMessageConfig) {
  logger.debug({
    msg: "RECEIVED iMESSAGE",
    text: msg.text?.substring(0, 100),
    sender: msg.sender,
    handle: msg.handle,
    is_group: msg.is_group,
    chat_id: msg.chat_id,
    service: msg.service,
  });

  if (!ctx) return;

  const sessionKey = buildSessionKey(msg);

  // Check if we should respond
  const respondResult = shouldRespond(msg, config);

  if (respondResult === "pairing") {
    // Generate pairing code and send it back
    const sender = msg.sender || msg.handle || "";
    if (sender) {
      const code = createPairingRequest(sender);
      const pairingMsg = buildPairingMessage(code);
      logger.debug({
        msg: "Pairing code generated for iMessage contact",
        sender,
      });
      await sendResponse(msg, pairingMsg, config);
    }
    return;
  }

  if (!respondResult) {
    // Still log to session for context
    try {
      ctx.logMessage(sessionKey, msg.text, {
        from: msg.sender || msg.handle || "unknown",
        channel: { type: "imessage", id: String(msg.chat_id || "dm") },
      });
    } catch (_e) {}
    return;
  }

  // Queue the message for processing
  messageQueue.push({ msg, receivedAt: Date.now() });
}

/**
 * Process queued messages
 */
async function processMessageQueue(config: IMessageConfig) {
  if (!ctx || messageQueue.length === 0) return;

  // Process one message at a time
  const item = messageQueue.shift();
  if (!item) return;

  const { msg } = item;
  const sessionKey = buildSessionKey(msg);

  try {
    // Inject to WOPR
    const response = await ctx.inject(sessionKey, msg.text!, {
      from: msg.sender || msg.handle || "unknown",
      channel: { type: "imessage", id: String(msg.chat_id || "dm") },
    });

    // Send response back via iMessage
    await sendResponse(msg, response, config);
  } catch (error: unknown) {
    logger.error({ msg: "Failed to process iMessage", error: error instanceof Error ? error.message : String(error) });

    // Try to send error response
    try {
      await sendResponse(msg, "Sorry, I couldn't process that message. Please try again.", config);
    } catch (_e) {}
  }
}

/**
 * Send response back via iMessage
 */
async function sendResponse(originalMsg: IncomingMessage, text: string, config: IMessageConfig) {
  if (!client || !client.isRunning()) {
    logger.warn("Cannot send response - client not running");
    return;
  }

  // Chunk text if needed
  const chunkLimit = config.textChunkLimit || IMESSAGE_CHUNK_LIMIT;
  const chunks: string[] = [];

  if (text.length <= chunkLimit) {
    chunks.push(text);
  } else {
    // Simple chunking - split at paragraph boundaries if possible
    let remaining = text;
    while (remaining.length > 0) {
      if (remaining.length <= chunkLimit) {
        chunks.push(remaining);
        break;
      }

      // Try to find a good break point
      let breakPoint = remaining.lastIndexOf("\n\n", chunkLimit);
      if (breakPoint < chunkLimit * 0.5) {
        breakPoint = remaining.lastIndexOf("\n", chunkLimit);
      }
      if (breakPoint < chunkLimit * 0.5) {
        breakPoint = remaining.lastIndexOf(". ", chunkLimit);
      }
      if (breakPoint < chunkLimit * 0.5) {
        breakPoint = chunkLimit;
      }

      chunks.push(remaining.substring(0, breakPoint + 1));
      remaining = remaining.substring(breakPoint + 1).trim();
    }
  }

  // Send each chunk
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const isLast = i === chunks.length - 1;

    // Add continuation indicator if not last
    const textToSend = isLast ? chunk : `${chunk} …`;

    const params: any = {
      text: textToSend,
      service: config.service || "auto",
      region: config.region || "US",
    };

    // Target by chat_id if available, otherwise by handle
    if (originalMsg.chat_id) {
      params.chat_id = originalMsg.chat_id;
    } else if (originalMsg.chat_guid) {
      params.chat_guid = originalMsg.chat_guid;
    } else if (originalMsg.chat_identifier) {
      params.chat_identifier = originalMsg.chat_identifier;
    } else if (originalMsg.handle) {
      params.to = originalMsg.handle;
    } else {
      logger.error({ msg: "Cannot send response - no target" });
      return;
    }

    try {
      await client.sendMessage(params);
      logger.debug({
        msg: "Sent iMessage response",
        chat_id: originalMsg.chat_id,
      });

      // Small delay between chunks
      if (!isLast) {
        await new Promise((r) => setTimeout(r, 500));
      }
    } catch (error: unknown) {
      logger.error({
        msg: "Failed to send iMessage response",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

/**
 * Detect if running on macOS
 */
function isMacOS(): boolean {
  return process.platform === "darwin";
}

const plugin: WOPRPlugin = {
  name: "wopr-plugin-imessage",
  version: "1.0.0",
  description: "iMessage/SMS integration for macOS via imsg CLI",

  async init(context: WOPRPluginContext) {
    ctx = context;
    ctx.registerConfigSchema("wopr-plugin-imessage", configSchema);

    // Check platform
    if (!isMacOS()) {
      logger.warn(`iMessage plugin requires macOS. Current platform: ${process.platform}`);
      return;
    }

    // Load agent identity
    await refreshIdentity();

    // Get config
    const fullConfig = ctx.getConfig<{
      channels?: { imessage?: IMessageConfig };
    }>();
    const config: IMessageConfig = fullConfig?.channels?.imessage || {};

    if (config.enabled === false) {
      logger.info("iMessage plugin disabled in config");
      return;
    }

    // Create and start client
    try {
      client = new IMessageClient({
        cliPath: config.cliPath,
        dbPath: config.dbPath,
        onMessage: (msg) => {
          // Re-read config each time so that allowlist changes (e.g. from claimPairingCode) are picked up
          const freshConfig: IMessageConfig =
            ctx?.getConfig<{ channels?: { imessage?: IMessageConfig } }>()?.channels?.imessage || {};
          handleIncomingMessage(msg, freshConfig);
        },
        onError: (err) => logger.error({ msg: "iMessage client error", error: err.message }),
      });

      await client.start();

      // Start message processing loop
      processingInterval = setInterval(() => {
        const freshQueueConfig: IMessageConfig =
          ctx?.getConfig<{ channels?: { imessage?: IMessageConfig } }>()?.channels?.imessage || {};
        processMessageQueue(freshQueueConfig).catch((err) => {
          logger.error({
            msg: "Message queue processing error",
            error: err.message,
          });
        });
      }, 100);

      // Clean up expired pairings every minute
      cleanupInterval = setInterval(cleanupExpiredPairings, 60 * 1000);

      logger.info("iMessage plugin initialized successfully");

      // Log helpful info
      logger.info({
        msg: "iMessage configuration",
        dmPolicy: config.dmPolicy || "pairing",
        groupPolicy: config.groupPolicy || "allowlist",
        service: config.service || "auto",
      });
    } catch (error: unknown) {
      logger.error({
        msg: "Failed to initialize iMessage client",
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  },

  async shutdown() {
    if (ctx) {
      ctx.unregisterConfigSchema("wopr-plugin-imessage");
    }

    if (cleanupInterval) {
      clearInterval(cleanupInterval);
      cleanupInterval = null;
    }

    if (processingInterval) {
      clearInterval(processingInterval);
      processingInterval = null;
    }

    if (client) {
      await client.stop();
      client = null;
    }

    logger.info("iMessage plugin stopped");
  },
};

export default plugin;

// Export routing helpers for unit testing
export { shouldRespond, buildSessionKey };

// Re-export pairing API for CLI commands (wopr imessage approve <code>)
export {
  buildPairingMessage,
  claimPairingCode,
  createPairingRequest,
  getPairingRequest,
  listPairingRequests,
} from "./pairing.js";
