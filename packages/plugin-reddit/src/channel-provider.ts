import { logger } from "./logger.js";
import type { RedditClient } from "./reddit-client.js";
import type {
  ChannelCommand,
  ChannelMessageContext,
  ChannelMessageParser,
  ChannelNotificationCallbacks,
  ChannelNotificationPayload,
  ChannelProvider,
} from "./types.js";

let client: RedditClient | null = null;
let botUsername = "unknown";
let defaultSubject: string | undefined;

export function setRedditClient(c: RedditClient | null): void {
  client = c;
}

export function setBotUsername(username: string): void {
  botUsername = username;
}

export function setDefaultSubject(subject: string | undefined): void {
  defaultSubject = subject;
}

function deriveSubject(content: string): string {
  if (defaultSubject) return defaultSubject;
  const trimmed = content.trim();
  return trimmed.length > 50 ? trimmed.slice(0, 50) : trimmed;
}

const registeredCommands: Map<string, ChannelCommand> = new Map();
const registeredParsers: Map<string, ChannelMessageParser> = new Map();

export const redditChannelProvider: ChannelProvider = {
  id: "reddit",

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
    if (!client) throw new Error("Reddit client not initialized");
    // channelId formats: "subreddit:<name>" for posts, "reddit:dm:<username>" or bare "<username>" for DMs
    if (channelId.startsWith("subreddit:")) {
      const sub = channelId.slice("subreddit:".length);
      await client.submitSelfPost(sub, deriveSubject(content), content);
    } else {
      const username = channelId.startsWith("reddit:dm:") ? channelId.slice("reddit:dm:".length) : channelId;
      await client.sendDirectMessage(username, deriveSubject(content), content);
    }
  },

  getBotUsername(): string {
    return botUsername;
  },

  async sendNotification(
    channelId: string,
    payload: ChannelNotificationPayload,
    callbacks: ChannelNotificationCallbacks = {},
  ): Promise<void> {
    if (payload.type !== "friend-request") {
      logger.warn({ msg: "Unsupported notification type", type: payload.type });
      return;
    }

    if (!client) throw new Error("Reddit client not initialized");

    const username = channelId.replace(/^reddit:dm:/, "");
    const fromName = payload.from || "Someone";

    const notifId = Math.random().toString(36).slice(2, 6).toUpperCase();
    const subject = "WOPR Friend Request";
    const body = `Friend request from u/${fromName}.\n\nReply ACCEPT ${notifId} to approve or DENY ${notifId} to reject.`;

    await client.sendDirectMessage(username, subject, body);

    const parserId = `notif:${username}:${crypto.randomUUID().slice(0, 8)}`;
    pendingNotifications.set(parserId, callbacks);

    const cleanup = (): void => {
      redditChannelProvider.removeMessageParser(parserId);
      pendingNotifications.delete(parserId);
    };

    // Orphan prevention: remove parser after 24 hours if no reply received
    const ttlTimer = setTimeout(cleanup, 24 * 60 * 60 * 1000);

    const parser: ChannelMessageParser = {
      id: parserId,
      pattern: (msg: string) => {
        const trimmed = msg.trim().toUpperCase();
        return trimmed === `ACCEPT ${notifId}` || trimmed === `DENY ${notifId}`;
      },
      handler: async (ctx: ChannelMessageContext): Promise<void> => {
        if (ctx.sender.toLowerCase() !== username.toLowerCase()) return;

        const response = ctx.content.trim().toUpperCase();
        const cbs = pendingNotifications.get(parserId);
        if (!cbs) return;

        clearTimeout(ttlTimer);
        cleanup();

        try {
          if (response === `ACCEPT ${notifId}` && cbs.onAccept) {
            await cbs.onAccept();
            await ctx.reply("Friend request accepted.");
          } else if (response === `DENY ${notifId}` && cbs.onDeny) {
            await cbs.onDeny();
            await ctx.reply("Friend request denied.");
          }
        } catch (err) {
          logger.error({ msg: "Notification callback failed", error: String(err), parserId });
        }
        // Signal to caller that this handler consumed the message
        return true as any; // biome-ignore lint/suspicious/noExplicitAny: signals consumption to adapter
      },
    };

    redditChannelProvider.addMessageParser(parser);
    logger.info({ msg: "Notification sent", type: payload.type, from: fromName, to: username, parserId });
  },
};

const pendingNotifications: Map<string, ChannelNotificationCallbacks> = new Map();

export function getPendingNotification(parserId: string): ChannelNotificationCallbacks | undefined {
  return pendingNotifications.get(parserId);
}

export function removePendingNotification(parserId: string): void {
  redditChannelProvider.removeMessageParser(parserId);
  pendingNotifications.delete(parserId);
}

export function clearRegistrations(): void {
  registeredCommands.clear();
  registeredParsers.clear();
  pendingNotifications.clear();
}
