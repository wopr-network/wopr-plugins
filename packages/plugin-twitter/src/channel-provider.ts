/**
 * Twitter Channel Provider.
 *
 * Implements ChannelProvider interface so other plugins can register
 * commands and message parsers that work within Twitter.
 */

import { logger } from "./logger.js";
import type { TwitterClient } from "./twitter-client.js";
import type { ChannelCommand, ChannelMessageParser, ChannelProvider } from "./types.js";

let twitterClient: TwitterClient | null = null;
let botUsername = "unknown";
let ownerUserId: string | null = null;

export function setTwitterProviderClient(c: TwitterClient | null, username?: string, ownerId?: string): void {
  twitterClient = c;
  if (c === null) {
    ownerUserId = null;
  }
  if (username) botUsername = username;
  if (c !== null && ownerId) ownerUserId = ownerId;
}

const registeredCommands: Map<string, ChannelCommand> = new Map();
const registeredParsers: Map<string, ChannelMessageParser> = new Map();

export function getRegisteredCommand(name: string): ChannelCommand | undefined {
  return registeredCommands.get(name);
}

export const twitterChannelProvider: ChannelProvider = {
  id: "twitter",

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
    if (!twitterClient) throw new Error("Twitter client not initialized");
    // channelId can be a tweet ID (reply) or a user ID (DM)
    // Convention: "tweet:<id>" for replies, "dm:<userId>" for DMs
    if (channelId.startsWith("dm:")) {
      const userId = channelId.slice(3);
      await twitterClient.sendDM(userId, content);
    } else if (channelId.startsWith("tweet:")) {
      const tweetId = channelId.slice(6);
      // Twitter reply limit: 280 chars. Truncate if needed.
      const truncated = content.length > 280 ? `${content.slice(0, 277)}...` : content;
      await twitterClient.tweet(truncated, { replyToId: tweetId });
    } else {
      // Default: post as a new tweet
      const truncated = content.length > 280 ? `${content.slice(0, 277)}...` : content;
      await twitterClient.tweet(truncated);
    }
  },

  getBotUsername(): string {
    return botUsername;
  },
};

const NOTIFICATION_TIMEOUT_MS = 5 * 60 * 1000;
const activeNotificationTimeouts: Set<ReturnType<typeof setTimeout>> = new Set();

/** Send a friend-request notification to the bot owner via DM (falls back to tweet). */
export async function sendNotification(
  _channelId: string,
  payload: { type: string; from: string; [key: string]: unknown },
  callbacks: { onAccept: () => Promise<void>; onDeny: () => Promise<void> },
): Promise<void> {
  if (payload.type !== "friend-request") return;
  if (!twitterClient) throw new Error("Twitter client not initialized");

  if (!ownerUserId) throw new Error("sendNotification: ownerUserId not set — cannot send notification");
  const targetUserId = ownerUserId;
  const message = `Friend request from @${payload.from}. Reply ACCEPT or DENY.`;

  const parserId = `notif-friend-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const timeoutHandle = setTimeout(() => {
    activeNotificationTimeouts.delete(timeoutHandle);
    twitterChannelProvider.removeMessageParser(parserId);
    logger.info({ msg: "Notification parser timed out", parserId });
  }, NOTIFICATION_TIMEOUT_MS);

  activeNotificationTimeouts.add(timeoutHandle);

  const parser: ChannelMessageParser = {
    id: parserId,
    pattern: (msg: string) => {
      const stripped = msg
        .trim()
        .replace(/^(@\w+\s+)+/, "")
        .toUpperCase();
      return stripped === "ACCEPT" || stripped === "DENY";
    },
    async handler(ctx) {
      // Only respond to messages from the owner
      if (ctx.sender !== targetUserId) return;
      clearTimeout(timeoutHandle);
      activeNotificationTimeouts.delete(timeoutHandle);
      twitterChannelProvider.removeMessageParser(parserId);
      const upper = ctx.content
        .trim()
        .replace(/^(@\w+\s+)+/, "")
        .toUpperCase();
      if (upper === "ACCEPT") {
        await callbacks.onAccept();
      } else {
        await callbacks.onDeny();
      }
    },
  };

  // Register parser BEFORE sending so a fast reply is never dropped
  twitterChannelProvider.addMessageParser(parser);
  logger.info({ msg: "Notification parser registered", parserId, from: payload.from });

  try {
    await twitterClient.sendDM(targetUserId, message);
  } catch (err: unknown) {
    const status =
      (err as { status?: number; code?: number })?.status ?? (err as { status?: number; code?: number })?.code;
    if (status === 403) {
      logger.warn({ msg: "DM not authorized (403), falling back to tweet" });
      try {
        await twitterClient.tweet(message, undefined);
      } catch (err2) {
        clearTimeout(timeoutHandle);
        activeNotificationTimeouts.delete(timeoutHandle);
        twitterChannelProvider.removeMessageParser(parserId);
        throw err2;
      }
    } else {
      // Transient error — clean up parser and rethrow; don't leak privately
      twitterChannelProvider.removeMessageParser(parserId);
      clearTimeout(timeoutHandle);
      activeNotificationTimeouts.delete(timeoutHandle);
      throw err;
    }
  }
}

export function clearNotificationParsers(): void {
  for (const handle of activeNotificationTimeouts) {
    clearTimeout(handle);
  }
  activeNotificationTimeouts.clear();
  const toDelete = [...registeredParsers.keys()].filter((id) => id.startsWith("notif-friend-"));
  for (const id of toDelete) {
    registeredParsers.delete(id);
  }
}
