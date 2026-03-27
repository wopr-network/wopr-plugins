/**
 * WOPR BlueBubbles Plugin - iMessage/SMS bridge via BlueBubbles server
 */

import path from "node:path";
import winston from "winston";
import { BlueBubblesClient } from "./bluebubbles-client.js";
import type {
  AgentIdentity,
  BBMessage,
  BlueBubblesConfig,
  ChannelInfo,
  ConfigSchema,
  LogMessageOptions,
  WOPRPlugin,
  WOPRPluginContext,
} from "./types.js";

// Module-level state
let ctx: WOPRPluginContext | null = null;
let config: BlueBubblesConfig = {};
let agentIdentity: AgentIdentity = { name: "WOPR", emoji: "💬" };
let bbClient: BlueBubblesClient | null = null;
let isShuttingDown = false;
let privateApiAvailable = false;
let logger: winston.Logger;
const cleanups: Array<() => void> = [];

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
    defaultMeta: { service: "wopr-plugin-bluebubbles" },
    transports: [
      new winston.transports.File({
        filename: path.join(WOPR_HOME, "logs", "bluebubbles-plugin-error.log"),
        level: "error",
      }),
      new winston.transports.File({
        filename: path.join(WOPR_HOME, "logs", "bluebubbles-plugin.log"),
        level: "debug",
      }),
      new winston.transports.Console({
        format: winston.format.combine(winston.format.colorize(), winston.format.simple()),
        level: "warn",
      }),
    ],
  });
}

// Config schema
const configSchema: ConfigSchema = {
  title: "BlueBubbles Integration",
  description: "Configure BlueBubbles iMessage/SMS bridge",
  fields: [
    {
      name: "serverUrl",
      type: "text",
      label: "Server URL",
      placeholder: "http://192.168.1.100:1234",
      required: true,
      description: "BlueBubbles server URL (include port)",
      setupFlow: "required",
    },
    {
      name: "password",
      type: "password",
      label: "Server Password",
      placeholder: "your-server-password",
      required: true,
      description: "BlueBubbles server password (shown in server app)",
      secret: true,
      setupFlow: "required",
    },
    {
      name: "dmPolicy",
      type: "select",
      label: "DM Policy",
      default: "open",
      description: "How to handle direct messages: open (anyone), allowlist, or disabled",
    },
    {
      name: "allowFrom",
      type: "array",
      label: "Allowed Senders",
      placeholder: "+15551234567, user@example.com",
      description: "Phone numbers or emails allowed to DM (for allowlist policy)",
    },
    {
      name: "groupPolicy",
      type: "select",
      label: "Group Policy",
      default: "open",
      description: "How to handle group chat messages",
    },
    {
      name: "groupAllowFrom",
      type: "array",
      label: "Allowed Group Senders",
      placeholder: "+15551234567",
      description: "Senders allowed to trigger in groups (for allowlist policy)",
    },
    {
      name: "mediaMaxMb",
      type: "number",
      label: "Media Max Size (MB)",
      default: 8,
      description: "Maximum inbound attachment size to process",
    },
    {
      name: "sendReadReceipts",
      type: "boolean",
      label: "Send Read Receipts",
      default: true,
      description: "Mark chats as read after processing (requires Private API)",
    },
    {
      name: "enableReactions",
      type: "boolean",
      label: "Enable Reactions",
      default: true,
      description: "Send acknowledgment reaction on incoming messages (requires Private API)",
    },
    {
      name: "enableAttachments",
      type: "boolean",
      label: "Enable Attachments",
      default: true,
      description: "Download and process incoming attachments",
    },
  ],
};

// Refresh agent identity
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

// Resolve credentials from config or environment variables
export function resolveCredentials(): { serverUrl: string; password: string } {
  const serverUrl = config.serverUrl || process.env.BLUEBUBBLES_URL;
  const password = config.password || process.env.BLUEBUBBLES_PASSWORD;

  if (!serverUrl) {
    throw new Error("BlueBubbles server URL required. Set serverUrl config or BLUEBUBBLES_URL env var.");
  }
  if (!password) {
    throw new Error("BlueBubbles password required. Set password config or BLUEBUBBLES_PASSWORD env var.");
  }

  return { serverUrl, password };
}

// Determine if a chat GUID is a group chat
// Group: "iMessage;+;chatNNN" (separator is "+")
// DM: "iMessage;-;+15551234567" (separator is "-")
export function isGroupChat(chatGuid: string): boolean {
  const parts = chatGuid.split(";");
  return parts.length >= 2 && parts[1] === "+";
}

// Check if sender is allowed based on policy config
export function isAllowed(senderAddress: string, isGroup: boolean): boolean {
  if (isGroup) {
    const policy = config.groupPolicy || "open";
    if (policy === "open") return true;
    if (policy === "disabled") return false;
    const allowed = config.groupAllowFrom || config.allowFrom || [];
    return allowed.includes("*") || allowed.some((a) => a.toLowerCase() === senderAddress.toLowerCase());
  } else {
    const policy = config.dmPolicy || "open";
    if (policy === "open") return true;
    if (policy === "disabled") return false;
    const allowed = config.allowFrom || [];
    return allowed.includes("*") || allowed.some((a) => a.toLowerCase() === senderAddress.toLowerCase());
  }
}

// Send a response back to a chat, splitting long messages
export async function sendResponse(chatGuid: string, text: string, replyToGuid?: string): Promise<void> {
  if (!bbClient) return;

  const maxLength = 4000;
  const chunks: string[] = [];

  if (text.length <= maxLength) {
    chunks.push(text);
  } else {
    let current = "";
    const sentences = text.split(/(?<=[.!?])\s+/);
    for (const sentence of sentences) {
      if (current.length + sentence.length + 1 <= maxLength) {
        current += (current ? " " : "") + sentence;
      } else {
        if (current) chunks.push(current);
        // If a single sentence is too long, split by character
        if (sentence.length > maxLength) {
          let remaining = sentence;
          while (remaining.length > maxLength) {
            chunks.push(remaining.slice(0, maxLength));
            remaining = remaining.slice(maxLength);
          }
          current = remaining;
        } else {
          current = sentence;
        }
      }
    }
    if (current) chunks.push(current);
  }

  for (let i = 0; i < chunks.length; i++) {
    try {
      await bbClient.sendText(chatGuid, chunks[i], {
        replyToGuid: i === 0 ? replyToGuid : undefined,
      });
    } catch (error: unknown) {
      logger.error("Failed to send BlueBubbles message chunk:", error);
    }
  }
}

// Handle an updated message (tapbacks/reactions from other party)
export async function handleUpdatedMessage(message: BBMessage): Promise<void> {
  if (!message.associatedMessageGuid) return;
  logger.info(
    `Received reaction ${message.associatedMessageType} from ${message.handle?.address} on message ${message.associatedMessageGuid}`,
  );
}

// Handle a new inbound message
export async function handleNewMessage(message: BBMessage): Promise<void> {
  if (isShuttingDown || !ctx || !bbClient) return;

  // Skip our own messages
  if (message.isFromMe) return;

  // Skip non-regular message types (group renames, participant changes)
  if (message.itemType !== 0) return;

  // Skip tapback reactions (they have an associatedMessageGuid)
  if (message.associatedMessageGuid !== null) return;

  // Skip messages with no chats array
  if (!message.chats || message.chats.length === 0) return;

  const chatGuid = message.chats[0].guid;
  const senderAddress = message.handle?.address;

  if (!senderAddress) return;

  const isGroup = isGroupChat(chatGuid);

  // Check policy
  if (!isAllowed(senderAddress, isGroup)) {
    logger.info(`Message from ${senderAddress} blocked by policy`);
    return;
  }

  // Build text content
  let text = message.text === "\ufffc" ? "" : message.text || "";

  // Process attachments
  if (message.attachments && message.attachments.length > 0 && config.enableAttachments !== false) {
    const maxBytes = (config.mediaMaxMb || 8) * 1024 * 1024;
    for (const attachment of message.attachments) {
      // Only download fully transferred attachments within size limit
      if (attachment.transferState !== 5) {
        logger.warn(
          `Attachment ${attachment.transferName} not fully downloaded (state=${attachment.transferState}), skipping`,
        );
        continue;
      }
      if (attachment.totalBytes > maxBytes) {
        logger.warn(
          `Attachment ${attachment.transferName} too large (${attachment.totalBytes} bytes > ${maxBytes}), skipping`,
        );
        continue;
      }
      try {
        const data = await bbClient.downloadAttachment(attachment.guid);
        if (!data || data.length === 0) {
          logger.error(`Attachment ${attachment.guid} download returned empty data`);
          await sendResponse(chatGuid, `Sorry, I couldn't download the attachment "${attachment.transferName}".`);
          return;
        }
        text += `${text ? " " : ""}[attachment: ${attachment.transferName}]`;
      } catch (error: unknown) {
        logger.error(`Failed to download attachment ${attachment.guid}:`, error);
        await sendResponse(chatGuid, `Sorry, I couldn't download the attachment "${attachment.transferName}".`);
        return;
      }
    }
  }

  // Skip if no content
  if (!text.trim()) return;

  // Build channel and session info
  const channelId = isGroup ? `group:${chatGuid}` : `dm:${senderAddress}`;
  const channelInfo: ChannelInfo = {
    type: "bluebubbles",
    id: channelId,
    name: isGroup ? message.chats[0].displayName || "Group Chat" : "BlueBubbles DM",
  };
  const sessionKey = `bluebubbles-${chatGuid}`;

  const logOptions: LogMessageOptions = {
    from: senderAddress,
    channel: channelInfo,
  };
  ctx.logMessage(sessionKey, text, logOptions);

  // Send ack reaction if Private API available and reactions enabled
  if (config.enableReactions !== false && privateApiAvailable) {
    try {
      await bbClient.sendReaction(chatGuid, message.guid, "+like");
    } catch (error: unknown) {
      logger.error("Failed to send reaction:", error);
    }
  }

  // Inject message into WOPR and get response
  const prefix = `[${senderAddress}]: `;
  let response: string;
  try {
    response = await ctx.inject(sessionKey, prefix + text, {
      from: senderAddress,
      channel: channelInfo,
    });
  } catch (error: unknown) {
    logger.error("Failed to inject message:", error);
    return;
  }

  // Send response back
  await sendResponse(chatGuid, response, message.guid);

  // Mark chat as read if Private API available
  if (config.sendReadReceipts !== false && privateApiAvailable) {
    try {
      await bbClient.markChatRead(chatGuid);
    } catch (error: unknown) {
      logger.error("Failed to mark chat as read:", error);
    }
  }
}

// Plugin definition
const plugin: WOPRPlugin = {
  name: "bluebubbles",
  version: "1.0.0",
  description: "BlueBubbles iMessage/SMS bridge",
  category: "channel",
  tags: ["imessage", "sms", "bluebubbles", "channel"],
  icon: "💬",
  capabilities: ["channel:bluebubbles"],
  provides: ["channel:bluebubbles"],
  requires: {},
  lifecycle: { singleton: true },
  configSchema,

  async init(context: WOPRPluginContext): Promise<void> {
    ctx = context;
    config = (context.getConfig() || {}) as BlueBubblesConfig;
    isShuttingDown = false;

    logger = initLogger();

    // Always register config schema
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ctx.registerConfigSchema("bluebubbles", configSchema as any);

    await refreshIdentity();

    // Validate credentials
    let serverUrl: string;
    let password: string;
    try {
      ({ serverUrl, password } = resolveCredentials());
    } catch (_: unknown) {
      logger.warn("No BlueBubbles credentials configured. Run 'wopr configure --plugin bluebubbles' to set up.");
      return;
    }

    // Create client and ping server
    bbClient = new BlueBubblesClient(serverUrl, password);

    try {
      const alive = await bbClient.ping();
      if (!alive) {
        logger.error("BlueBubbles server ping failed. Check server URL and password.");
        bbClient = null;
        return;
      }
    } catch (error: unknown) {
      logger.error("Failed to ping BlueBubbles server:", error);
      bbClient = null;
      return;
    }

    // Check Private API availability
    try {
      const serverInfo = await bbClient.getServerInfo();
      privateApiAvailable = serverInfo.data?.private_api ?? false;
      if (privateApiAvailable) {
        logger.info("BlueBubbles Private API is enabled -- reactions and read receipts active");
      } else {
        logger.warn("BlueBubbles Private API not enabled -- reactions and read receipts disabled");
      }
    } catch (error: unknown) {
      logger.warn("Failed to check Private API status:", error);
      privateApiAvailable = false;
    }

    // Wire event handlers
    bbClient.setOnNewMessage(handleNewMessage);
    bbClient.setOnUpdatedMessage(handleUpdatedMessage);

    // Connect Socket.IO
    try {
      await bbClient.connect();
      logger.info(`BlueBubbles plugin connected to ${serverUrl}`);
    } catch (error: unknown) {
      logger.error("Failed to connect to BlueBubbles server:", error);
    }
  },

  async shutdown(): Promise<void> {
    isShuttingDown = true;
    for (const cleanup of cleanups) {
      try {
        cleanup();
      } catch {
        /* swallow */
      }
    }
    cleanups.length = 0;
    bbClient?.disconnect();
    bbClient = null;
    privateApiAvailable = false;
    config = {};
    ctx = null;
  },
};

export default plugin;

// Export internals for unit testing
export { agentIdentity };
