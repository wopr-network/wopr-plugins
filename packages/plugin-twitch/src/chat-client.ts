import type { ApiClient } from "@twurple/api";
import type { AuthProvider } from "@twurple/auth";
import type { ChatMessage, Whisper } from "@twurple/chat";
import { ChatClient } from "@twurple/chat";
import type { ChannelRef, WOPRPluginContext } from "@wopr-network/plugin-types";
import { RateLimiter } from "./rate-limiter.js";
import { extractUserInfo, getRolePrefix } from "./role-mapper.js";
import type { TwitchConfig } from "./types.js";

// Max message length for Twitch chat
const TWITCH_MAX_MSG_LENGTH = 500;

export class TwitchChatManager {
  private chatClient: ChatClient | null = null;
  private rateLimiter = new RateLimiter();
  private botUsername: string = "unknown";

  constructor(
    private ctx: WOPRPluginContext,
    private config: TwitchConfig,
    private apiClient?: ApiClient,
    private botUserId?: string,
  ) {}

  async connect(authProvider: AuthProvider): Promise<void> {
    const channels = this.parseChannels(this.config.channels);

    this.chatClient = new ChatClient({
      authProvider,
      channels,
    });

    this.chatClient.onMessage(async (channel: string, user: string, text: string, msg: ChatMessage) => {
      await this.handleMessagePublic(channel, user, text, msg);
    });

    if (this.config.enableWhispers !== false) {
      this.chatClient.onWhisper(async (user: string, text: string, msg: Whisper) => {
        await this.handleWhisperPublic(user, text, msg);
      });
    }

    this.chatClient.onSub((channel, user) => {
      this.ctx.log.info(`New subscriber: ${user} in ${channel}`);
    });

    this.chatClient.onResub((channel, user, subInfo) => {
      this.ctx.log.info(`Resub: ${user} for ${subInfo.months} months in ${channel}`);
    });

    this.chatClient.onRaid((channel, user, raidInfo) => {
      this.ctx.log.info(`Raid from ${user} with ${raidInfo.viewerCount} viewers in ${channel}`);
    });

    // Wait for connection — capture local ref since it's guaranteed non-null here
    const client = this.chatClient;
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Twitch connection timeout")), 30_000);
      client.onConnect(() => {
        clearTimeout(timeout);
        resolve();
      });
      client.onDisconnect((_manually, reason) => {
        if (reason) {
          clearTimeout(timeout);
          reject(reason);
        }
      });
      client.connect();
    });

    this.ctx.log.info(`Connected to Twitch channels: ${channels.join(", ")}`);
  }

  /** Set the bot's username (called from index.ts after auth) */
  setBotUsername(username: string): void {
    this.botUsername = username;
  }

  /** Exposed for testing — handles an incoming chat message */
  async handleMessagePublic(channel: string, _user: string, text: string, msg: ChatMessage | Whisper): Promise<void> {
    const userInfo = extractUserInfo(
      msg.userInfo.userId,
      msg.userInfo.userName,
      msg.userInfo.displayName,
      msg.userInfo,
    );

    // Skip own messages
    if (userInfo.username.toLowerCase() === this.botUsername.toLowerCase()) return;

    const cleanChannel = channel.replace(/^#/, "").toLowerCase();
    const channelId = `twitch:${cleanChannel}`;
    const sessionKey = `twitch-${cleanChannel}`;

    const channelRef: ChannelRef = {
      type: "twitch",
      id: channelId,
      name: cleanChannel,
    };

    this.ctx.logMessage(sessionKey, text, {
      from: userInfo.displayName,
      channel: channelRef,
    });

    const prefix = `[${getRolePrefix(userInfo)}]: `;
    const messageWithPrefix = prefix + text;

    const response = await this.ctx.inject(sessionKey, messageWithPrefix, {
      from: userInfo.displayName,
      channel: channelRef,
    });

    await this.sendMessage(channel, response);
  }

  /** Exposed for testing — handles an incoming whisper */
  async handleWhisperPublic(user: string, text: string, msg: Whisper): Promise<void> {
    if (this.config.dmPolicy === "disabled") return;

    const userInfo = extractUserInfo(
      msg.userInfo.userId,
      msg.userInfo.userName,
      msg.userInfo.displayName,
      msg.userInfo,
    );

    const channelId = `twitch-whisper:${userInfo.userId}`;
    const sessionKey = `twitch-whisper-${userInfo.userId}`;

    const channelRef: ChannelRef = {
      type: "twitch",
      id: channelId,
      name: `Whisper from ${userInfo.displayName}`,
    };

    this.ctx.logMessage(sessionKey, text, {
      from: userInfo.displayName,
      channel: channelRef,
    });

    const textPrefix = `[${userInfo.displayName}]: `;
    const response = await this.ctx.inject(sessionKey, textPrefix + text, {
      from: userInfo.displayName,
      channel: channelRef,
    });

    try {
      await this.sendWhisper(user, userInfo.userId, response);
    } catch (error: unknown) {
      this.ctx.log.error(`Failed to send whisper to ${user}: ${error}`);
    }
  }

  async sendMessage(channel: string, text: string): Promise<void> {
    if (!this.chatClient) throw new Error("Twitch chat not connected");

    const chunks = this.splitMessagePublic(text, TWITCH_MAX_MSG_LENGTH);
    for (const chunk of chunks) {
      await this.rateLimiter.waitForToken();
      await this.chatClient.say(channel, chunk);
    }
  }

  async sendWhisper(toUsername: string, toUserId: string, text: string): Promise<void> {
    if (!this.apiClient || !this.botUserId) {
      this.ctx.log.warn(`Whisper to ${toUsername} skipped: API client or bot user ID not configured`);
      return;
    }

    const chunks = this.splitMessagePublic(text, TWITCH_MAX_MSG_LENGTH);
    for (const chunk of chunks) {
      await this.rateLimiter.waitForToken();
      await this.apiClient.whispers.sendWhisper(this.botUserId, toUserId, chunk);
    }
  }

  /** Exposed for testing — split message into chunks at word boundaries */
  splitMessagePublic(text: string, maxLen: number): string[] {
    if (text.length <= maxLen) return [text];

    const chunks: string[] = [];
    let remaining = text;

    while (remaining.length > 0) {
      if (remaining.length <= maxLen) {
        chunks.push(remaining);
        break;
      }

      let splitAt = remaining.lastIndexOf(" ", maxLen);
      if (splitAt < maxLen * 0.6) splitAt = maxLen;
      chunks.push(remaining.slice(0, splitAt));
      remaining = remaining.slice(splitAt).trimStart();
    }

    return chunks;
  }

  getBotUsername(): string {
    return this.botUsername;
  }

  async disconnect(): Promise<void> {
    if (this.chatClient) {
      this.chatClient.quit();
      this.chatClient = null;
    }
  }

  private parseChannels(channels: string[] | string | undefined): string[] {
    if (!channels) return [];
    if (Array.isArray(channels)) return channels;
    return channels
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
}
