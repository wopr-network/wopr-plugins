import type {
  ChannelCommand,
  ChannelCommandContext,
  ChannelMessageContext,
  ChannelMessageParser,
  ChannelProvider,
} from "@wopr-network/plugin-types";
import type { MatrixClient } from "matrix-bot-sdk";
import { logger } from "./logger.js";
import { chunkMessage, escapeHtml, formatMessage } from "./message-formatter.js";
import { ACCEPT_EMOJI, DENY_EMOJI, storePendingNotification } from "./notification-reactions.js";

export interface ChannelNotificationPayload {
  type: string;
  from?: string;
  pubkey?: string;
  [key: string]: unknown;
}

export interface ChannelNotificationCallbacks {
  onAccept?: () => Promise<void>;
  onDeny?: () => Promise<void>;
}

let matrixClient: MatrixClient | null = null;

export function setChannelProviderClient(c: MatrixClient | null): void {
  matrixClient = c;
}

const registeredCommands: Map<string, ChannelCommand> = new Map();

export function getRegisteredCommand(name: string): ChannelCommand | undefined {
  return registeredCommands.get(name);
}

const registeredParsers: Map<string, ChannelMessageParser> = new Map();

let cachedBotUsername = "unknown";

export function setCachedBotUsername(username: string): void {
  cachedBotUsername = username;
}

export const matrixChannelProvider: ChannelProvider & {
  sendNotification?: (
    channelId: string,
    payload: ChannelNotificationPayload,
    callbacks?: ChannelNotificationCallbacks,
  ) => Promise<void>;
} = {
  id: "matrix",

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

  async send(roomId: string, content: string): Promise<void> {
    if (!matrixClient) throw new Error("Matrix client not initialized");
    const chunks = chunkMessage(content);
    for (const chunk of chunks) {
      if (chunk.trim()) {
        const msgContent = formatMessage(chunk);
        await matrixClient.sendMessage(roomId, msgContent);
      }
    }
  },

  getBotUsername(): string {
    return cachedBotUsername;
  },

  async sendNotification(
    channelId: string,
    payload: ChannelNotificationPayload,
    callbacks?: ChannelNotificationCallbacks,
  ): Promise<void> {
    if (payload.type !== "p2p:friendRequest:pending") return;

    if (!matrixClient) {
      logger.warn("sendNotification called but Matrix client not initialized");
      return;
    }

    const from = payload.from ?? "unknown";
    const pubkeyShort = payload.pubkey ? `${payload.pubkey.slice(0, 8)}...` : "n/a";

    const body =
      `Friend Request from ${from}\n` +
      `Pubkey: ${pubkeyShort}\n\n` +
      `React ${ACCEPT_EMOJI} to accept or ${DENY_EMOJI} to deny.`;

    const safeFrom = escapeHtml(payload.from ?? "unknown");
    const safePubkey = escapeHtml(pubkeyShort);

    const htmlBody =
      `<b>Friend Request from ${safeFrom}</b><br/>` +
      `Pubkey: <code>${safePubkey}</code><br/><br/>` +
      `React ${ACCEPT_EMOJI} to accept or ${DENY_EMOJI} to deny.`;

    try {
      const eventId = await matrixClient.sendMessage(channelId, {
        msgtype: "m.text",
        body,
        format: "org.matrix.custom.html",
        formatted_body: htmlBody,
      });

      if (callbacks && (callbacks.onAccept || callbacks.onDeny)) {
        storePendingNotification(eventId, channelId, {
          onAccept: callbacks.onAccept,
          onDeny: callbacks.onDeny,
        });
      }

      logger.info({ msg: "Friend request notification sent", from, roomId: channelId, eventId });
    } catch (error) {
      logger.error({ msg: "Failed to send notification", from, roomId: channelId, error: String(error) });
    }
  },
};

/**
 * Check if a message matches a registered command and handle it.
 * Matrix convention: ! prefix for bot commands.
 */
export async function handleRegisteredCommand(
  roomId: string,
  senderId: string,
  body: string,
  replyFn: (msg: string) => Promise<void>,
): Promise<boolean> {
  const content = body.trim();
  if (!content.startsWith("!")) return false;

  const parts = content.slice(1).split(/\s+/);
  const cmdName = parts[0].toLowerCase();
  const args = parts.slice(1);

  const cmd = registeredCommands.get(cmdName);
  if (!cmd) return false;

  const cmdCtx: ChannelCommandContext = {
    channel: roomId,
    channelType: "matrix",
    sender: senderId,
    args,
    reply: replyFn,
    getBotUsername: () => cachedBotUsername,
  };

  try {
    await cmd.handler(cmdCtx);
    return true;
  } catch (error) {
    logger.error({ msg: "Channel command error", cmd: cmdName, error: String(error) });
    await replyFn(`Error executing !${cmdName}: ${error}`);
    return true;
  }
}

/**
 * Check if a message matches any registered parser and handle it.
 */
export async function handleRegisteredParsers(
  roomId: string,
  senderId: string,
  body: string,
  replyFn: (msg: string) => Promise<void>,
): Promise<boolean> {
  for (const parser of registeredParsers.values()) {
    let matches = false;
    if (typeof parser.pattern === "function") {
      matches = parser.pattern(body);
    } else {
      parser.pattern.lastIndex = 0;
      matches = parser.pattern.test(body);
    }

    if (matches) {
      const msgCtx: ChannelMessageContext = {
        channel: roomId,
        channelType: "matrix",
        sender: senderId,
        content: body,
        reply: replyFn,
        getBotUsername: () => cachedBotUsername,
      };

      try {
        await parser.handler(msgCtx);
        return true;
      } catch (error) {
        logger.error({ msg: "Message parser error", id: parser.id, error: String(error) });
        return false;
      }
    }
  }
  return false;
}
