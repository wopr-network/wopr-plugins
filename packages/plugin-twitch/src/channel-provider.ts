import type {
  ChannelCommand,
  ChannelCommandContext,
  ChannelMessageContext,
  ChannelMessageParser,
  ChannelProvider,
} from "@wopr-network/plugin-types";

export interface ChannelNotificationPayload {
  type: string;
  from?: string;
  pubkey?: string;
  encryptPub?: string;
  signature?: string;
  channelName?: string;
  [key: string]: unknown;
}

export interface ChannelNotificationCallbacks {
  onAccept?: () => Promise<void>;
  onDeny?: () => Promise<void>;
}

// Minimal interface for what channel-provider needs from TwitchChatManager
interface ChatManagerLike {
  sendMessage(channel: string, text: string): Promise<void>;
  getBotUsername(): string;
}

let chatManager: ChatManagerLike | null = null;

export function setChatManager(mgr: ChatManagerLike | null): void {
  chatManager = mgr;
}

const registeredCommands: Map<string, ChannelCommand> = new Map();
const registeredParsers: Map<string, ChannelMessageParser> = new Map();

const NOTIFICATION_TTL_MS = 5 * 60 * 1000; // 5 minutes

export const twitchChannelProvider: ChannelProvider & {
  sendNotification?: (
    channelId: string,
    payload: ChannelNotificationPayload,
    callbacks?: ChannelNotificationCallbacks,
  ) => Promise<void>;
} = {
  id: "twitch",

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

  async send(channelId: string, content: string): Promise<void> {
    if (!chatManager) throw new Error("Twitch chat not connected");
    // channelId format: "twitch:<channel>" — extract channel name
    const channel = channelId.replace(/^twitch:/, "");
    await chatManager.sendMessage(`#${channel}`, content);
  },

  getBotUsername(): string {
    return chatManager?.getBotUsername() ?? "unknown";
  },

  async sendNotification(
    channelId: string,
    payload: ChannelNotificationPayload,
    callbacks?: ChannelNotificationCallbacks,
  ): Promise<void> {
    if (payload.type !== "friend-request") return;
    if (!chatManager) throw new Error("Twitch chat not connected");

    // Finding 4: Guard against numeric broadcaster IDs — they cannot be used as channel names
    const channel = channelId.replace(/^twitch:/, "");
    if (/^\d+$/.test(channel)) {
      console.warn(
        `[twitch] sendNotification received numeric broadcaster ID "${channel}" instead of channel name — cannot post chat message`,
      );
      return;
    }

    const fromLabel = payload.from || payload.pubkey || "unknown peer";

    // Finding 2: Generate a unique short ID so concurrent notifications don't collide
    const shortId = Math.random().toString(36).slice(2, 6).toUpperCase();

    await chatManager.sendMessage(
      `#${channel}`,
      `@${channel} Friend request from ${fromLabel} [ID: ${shortId}]. Reply !accept ${shortId} or !deny ${shortId}`,
    );

    const parserId = `notif-fr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    // Finding 3: TTL — expire the parser after 5 minutes if owner never replies
    const timeoutHandle = setTimeout(() => {
      registeredParsers.delete(parserId);
    }, NOTIFICATION_TTL_MS);

    const parser: ChannelMessageParser = {
      id: parserId,
      // Finding 2: Pattern requires the unique short ID to avoid collision between concurrent requests
      pattern: (msg: string) => {
        const lower = msg.trim().toLowerCase();
        return lower === `!accept ${shortId.toLowerCase()}` || lower === `!deny ${shortId.toLowerCase()}`;
      },
      handler: async (ctx: ChannelMessageContext) => {
        // Finding 1: Verify the message is from the correct channel, not another channel the bot is in
        if (ctx.channel?.replace(/^twitch:/, "").toLowerCase() !== channel.toLowerCase()) return;
        if (ctx.sender.toLowerCase() !== channel.toLowerCase()) return;

        const action = ctx.content.trim().toLowerCase();

        // Finding 3: Clear TTL timeout before removing parser
        clearTimeout(timeoutHandle);
        registeredParsers.delete(parserId);

        if (action === `!accept ${shortId.toLowerCase()}`) {
          await callbacks?.onAccept?.();
          await ctx.reply(`Friend request from ${fromLabel} accepted.`);
        } else if (action === `!deny ${shortId.toLowerCase()}`) {
          await callbacks?.onDeny?.();
          await ctx.reply(`Friend request from ${fromLabel} denied.`);
        }
      },
    };

    registeredParsers.set(parser.id, parser);
  },
};

/**
 * Check if a message matches a registered command and handle it.
 * Returns true if handled.
 */
export async function handleRegisteredCommand(
  channel: string,
  sender: string,
  text: string,
  prefix: string,
): Promise<boolean> {
  if (!text.startsWith(prefix)) return false;

  const parts = text.slice(prefix.length).split(/\s+/);
  const cmdName = parts[0]?.toLowerCase();
  if (!cmdName) return false;
  const args = parts.slice(1);

  const cmd = registeredCommands.get(cmdName);
  if (!cmd) return false;

  const cleanChannel = channel.replace(/^#/, "");
  const cmdCtx: ChannelCommandContext = {
    channel: `twitch:${cleanChannel}`,
    channelType: "twitch",
    sender,
    args,
    reply: async (msg: string) => {
      if (chatManager) await chatManager.sendMessage(channel, msg);
    },
    getBotUsername: () => chatManager?.getBotUsername() ?? "unknown",
  };

  try {
    await cmd.handler(cmdCtx);
    return true;
  } catch (error) {
    console.error(`[twitch] Error executing command ${prefix}${cmdName}:`, error);
    await cmdCtx.reply(`Sorry, an error occurred while executing that command.`);
    return true;
  }
}

/**
 * Check if a message matches any registered parser.
 * Returns true if handled.
 */
export async function handleRegisteredParsers(channel: string, sender: string, text: string): Promise<boolean> {
  const cleanChannel = channel.replace(/^#/, "");
  for (const parser of registeredParsers.values()) {
    let matches = false;
    if (typeof parser.pattern === "function") {
      matches = parser.pattern(text);
    } else {
      parser.pattern.lastIndex = 0;
      matches = parser.pattern.test(text);
    }

    if (matches) {
      const msgCtx: ChannelMessageContext = {
        channel: `twitch:${cleanChannel}`,
        channelType: "twitch",
        sender,
        content: text,
        reply: async (msg: string) => {
          if (chatManager) await chatManager.sendMessage(channel, msg);
        },
        getBotUsername: () => chatManager?.getBotUsername() ?? "unknown",
      };

      try {
        await parser.handler(msgCtx);
        return true;
      } catch (err) {
        console.error(`[twitch] Message parser "${parser.id}" threw an unhandled error:`, err);
        return false;
      }
    }
  }
  return false;
}
