import { ApiClient } from "@twurple/api";
import { getTokenInfo, RefreshingAuthProvider } from "@twurple/auth";
import type { ConfigSchema, WOPRPlugin, WOPRPluginContext } from "@wopr-network/plugin-types";
import { setChatManager, twitchChannelProvider } from "./channel-provider.js";
import { TwitchChatManager } from "./chat-client.js";
import { TwitchEventSubManager } from "./eventsub.js";
import type { TwitchConfig } from "./types.js";

let pluginCtx: WOPRPluginContext | null = null;
let chatManager: TwitchChatManager | null = null;
let eventSubManager: TwitchEventSubManager | null = null;
const cleanups: Array<() => void | Promise<void>> = [];

const configSchema: ConfigSchema = {
  title: "Twitch Integration",
  description: "Configure Twitch bot integration with chat, whispers, and channel points",
  fields: [
    {
      name: "clientId",
      type: "text",
      label: "Client ID",
      placeholder: "Twitch Application Client ID",
      required: true,
      description: "From the Twitch Developer Console",
      setupFlow: "paste",
    },
    {
      name: "clientSecret",
      type: "password",
      label: "Client Secret",
      placeholder: "Twitch Application Client Secret",
      required: true,
      description: "From the Twitch Developer Console",
      secret: true,
      setupFlow: "paste",
    },
    {
      name: "accessToken",
      type: "password",
      label: "Access Token",
      placeholder: "OAuth Access Token",
      required: true,
      description: "OAuth token with chat:read, chat:edit scopes",
      secret: true,
      setupFlow: "oauth",
      oauthProvider: "twitch",
    },
    {
      name: "refreshToken",
      type: "password",
      label: "Refresh Token",
      placeholder: "OAuth Refresh Token",
      description: "For automatic token refresh",
      secret: true,
      setupFlow: "oauth",
      oauthProvider: "twitch",
    },
    {
      name: "channels",
      type: "text",
      label: "Channels",
      placeholder: "channel1, channel2",
      required: true,
      description: "Comma-separated list of Twitch channels to join",
    },
    {
      name: "commandPrefix",
      type: "text",
      label: "Command Prefix",
      placeholder: "!",
      description: "Prefix for bot commands (default: !)",
    },
    {
      name: "broadcasterId",
      type: "text",
      label: "Broadcaster User ID",
      placeholder: "123456789",
      description: "Your Twitch user ID (required for channel points)",
    },
    {
      name: "enableWhispers",
      type: "boolean",
      label: "Enable Whispers",
      description: "Allow private whisper messages (default: true)",
    },
    {
      name: "enableChannelPoints",
      type: "boolean",
      label: "Enable Channel Points",
      description: "Listen for channel point redemptions (requires broadcasterId)",
    },
    {
      name: "dmPolicy",
      type: "select",
      label: "Whisper Policy",
      description: "How to handle incoming whispers",
      options: [
        { value: "open", label: "Open (respond to all whispers)" },
        { value: "disabled", label: "Disabled (ignore whispers)" },
      ],
    },
  ],
};

const plugin: WOPRPlugin = {
  name: "@wopr-network/wopr-plugin-twitch",
  version: "1.0.0",
  description: "Twitch chat integration with whispers and channel point redemptions",

  manifest: {
    name: "@wopr-network/wopr-plugin-twitch",
    version: "1.0.0",
    description: "Twitch chat integration with whispers and channel point redemptions",
    capabilities: ["channel"],
    requires: {
      env: [],
      network: { outbound: true, hosts: ["irc-ws.chat.twitch.tv", "api.twitch.tv"] },
    },
    category: "communication",
    tags: ["twitch", "chat", "streaming", "channel-points"],
    icon: "🎮",
    lifecycle: {
      shutdownBehavior: "drain",
      shutdownTimeoutMs: 10_000,
    },
    configSchema,
  },

  async init(ctx: WOPRPluginContext) {
    pluginCtx = ctx;
    ctx.registerConfigSchema("wopr-plugin-twitch", configSchema);
    cleanups.push(() => ctx.unregisterConfigSchema("wopr-plugin-twitch"));

    const config = ctx.getConfig<TwitchConfig>() ?? {};

    if (!config.clientId || !config.clientSecret || !config.accessToken) {
      ctx.log.warn("Twitch plugin not configured. Run 'wopr configure --plugin wopr-plugin-twitch'");
      return;
    }

    // Parse channels — config UI may send as comma-separated string
    const channels = Array.isArray(config.channels)
      ? config.channels
      : ((config.channels as string)
          ?.split(",")
          .map((s) => s.trim())
          .filter(Boolean) ?? []);

    if (channels.length === 0) {
      ctx.log.warn("No Twitch channels configured");
      return;
    }

    const authProvider = new RefreshingAuthProvider({
      clientId: config.clientId,
      clientSecret: config.clientSecret ?? "",
    });

    await authProvider.addUserForToken(
      {
        accessToken: config.accessToken,
        refreshToken: config.refreshToken ?? null,
        expiresIn: null,
        obtainmentTimestamp: Date.now(),
        scope: [
          "chat:read",
          "chat:edit",
          "whispers:read",
          "whispers:edit",
          "channel:read:redemptions",
          "channel:manage:redemptions",
        ],
      },
      ["chat"],
    );

    authProvider.onRefresh(async (_userId, newToken) => {
      ctx.log.info("Twitch OAuth token refreshed");
      await ctx.saveConfig({
        ...config,
        accessToken: newToken.accessToken,
        ...(newToken.refreshToken !== null ? { refreshToken: newToken.refreshToken } : {}),
      });
    });

    const apiClient = new ApiClient({ authProvider });

    let botUserId: string | undefined;
    let botUsername: string | undefined;
    try {
      const tokenInfo = await getTokenInfo(config.accessToken, config.clientId);
      botUserId = tokenInfo.userId ?? undefined;
      botUsername = tokenInfo.userName ?? undefined;
    } catch (error: unknown) {
      ctx.log.warn(`Could not resolve bot user info: ${error}`);
    }

    chatManager = new TwitchChatManager(ctx, { ...config, channels }, apiClient, botUserId);

    try {
      await chatManager.connect(authProvider);
      if (botUsername) {
        chatManager.setBotUsername(botUsername);
        ctx.log.info(`Bot username set: ${botUsername}`);
      }
    } catch (error: unknown) {
      ctx.log.error(`Failed to connect to Twitch chat: ${error}`);
      return;
    }

    setChatManager(chatManager);
    ctx.registerChannelProvider(twitchChannelProvider);
    cleanups.push(() => ctx.unregisterChannelProvider("twitch"));
    ctx.log.info("Registered Twitch channel provider");

    if (config.enableChannelPoints && config.broadcasterId) {
      eventSubManager = new TwitchEventSubManager(ctx, config.broadcasterId);
      try {
        await eventSubManager.start(authProvider);
      } catch (error: unknown) {
        ctx.log.error(`Failed to start EventSub: ${error}`);
        // Non-fatal — chat still works without channel points
      }
    }

    ctx.log.info("Twitch plugin initialized");
  },

  async shutdown() {
    if (!pluginCtx) return;

    if (eventSubManager) {
      await eventSubManager.stop();
      eventSubManager = null;
    }

    if (chatManager) {
      await chatManager.disconnect();
      setChatManager(null);
      chatManager = null;
    }

    for (const cleanup of cleanups) {
      await cleanup();
    }
    cleanups.length = 0;

    pluginCtx = null;
  },
};

export default plugin;
