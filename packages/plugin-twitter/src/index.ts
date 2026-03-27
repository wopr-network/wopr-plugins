/**
 * WOPR Twitter Plugin — Orchestrator
 *
 * Wires together the Twitter client, channel provider, and stream manager.
 * Handles the WOPRPlugin lifecycle (init/shutdown).
 */

import { clearNotificationParsers, setTwitterProviderClient, twitterChannelProvider } from "./channel-provider.js";
import { logger } from "./logger.js";
import { StreamManager } from "./stream-manager.js";
import { TwitterClient } from "./twitter-client.js";
import type { ConfigSchema, TwitterConfig, WOPRPlugin, WOPRPluginContext } from "./types.js";

let twitterClient: TwitterClient | null = null;
let streamManager: StreamManager | null = null;
let ctx: WOPRPluginContext | null = null;

const configSchema: ConfigSchema = {
  title: "Twitter/X Integration",
  description: "Configure Twitter/X bot integration",
  fields: [
    {
      name: "apiKey",
      type: "password",
      label: "API Key",
      placeholder: "Twitter API Key from Developer Portal",
      required: true,
      secret: true,
      description: "Your Twitter API Key (Consumer Key)",
    },
    {
      name: "apiKeySecret",
      type: "password",
      label: "API Key Secret",
      placeholder: "Twitter API Key Secret",
      required: true,
      secret: true,
      description: "Your Twitter API Key Secret (Consumer Secret)",
    },
    {
      name: "accessToken",
      type: "password",
      label: "Access Token",
      placeholder: "User Access Token",
      required: true,
      secret: true,
      description: "OAuth 1.0a User Access Token",
    },
    {
      name: "accessTokenSecret",
      type: "password",
      label: "Access Token Secret",
      placeholder: "User Access Token Secret",
      required: true,
      secret: true,
      description: "OAuth 1.0a User Access Token Secret",
    },
    {
      name: "bearerToken",
      type: "password",
      label: "Bearer Token (optional)",
      placeholder: "App-only Bearer Token",
      secret: true,
      description: "Bearer token for app-only endpoints (search, stream). Optional if using OAuth 1.0a.",
    },
    {
      name: "streamKeywords",
      type: "text",
      label: "Stream Keywords (optional)",
      placeholder: "keyword1, keyword2",
      description: "Comma-separated keywords to monitor via filtered stream",
    },
  ],
};

const plugin: WOPRPlugin = {
  name: "wopr-plugin-twitter",
  version: "0.1.0",
  description: "Twitter/X bot with timeline, mentions, DMs, and streaming",
  manifest: {
    name: "wopr-plugin-twitter",
    version: "0.1.0",
    description: "Twitter/X bot with timeline, mentions, DMs, and streaming",
    capabilities: ["channel"],
    category: "channel",
    tags: ["twitter", "x", "social", "bot", "messaging"],
    icon: "🐦",
    requires: {
      network: { outbound: true },
    },
    provides: {
      capabilities: [{ type: "channel", id: "twitter", displayName: "Twitter/X" }],
    },
    lifecycle: { shutdownBehavior: "graceful" },
    configSchema,
  },

  async init(context: WOPRPluginContext) {
    ctx = context;
    ctx.registerConfigSchema("wopr-plugin-twitter", configSchema);

    // Register setup context provider for conversational setup
    if (ctx.registerSetupContextProvider) {
      ctx.registerSetupContextProvider(({ partialConfig }) => {
        const hasApiKey = !!partialConfig.apiKey;
        const hasAccessToken = !!partialConfig.accessToken;

        let instructions =
          "You are helping the user set up the Twitter/X plugin for WOPR.\n\n## Twitter Developer Setup\n\n";

        if (!hasApiKey) {
          instructions += "### Step 1: Create a Twitter Developer App\n";
          instructions += "1. Go to https://developer.twitter.com/en/portal/dashboard\n";
          instructions += '2. Create a new Project and App (choose "Free" or "Basic" tier)\n';
          instructions += '3. Under "Keys and Tokens", generate your API Key and API Key Secret\n';
          instructions += "4. Paste both values here\n\n";
        } else {
          instructions += "### Step 1: API Key\nAPI Key is configured.\n\n";
        }

        if (!hasAccessToken) {
          instructions += "### Step 2: Generate Access Tokens\n";
          instructions += '1. In the same app, go to "Keys and Tokens"\n';
          instructions += '2. Under "Authentication Tokens", generate Access Token and Secret\n';
          instructions += "3. Make sure the app has Read and Write permissions\n";
          instructions += "4. Paste the Access Token and Access Token Secret here\n\n";
        } else {
          instructions += "### Step 2: Access Tokens\nAccess tokens are configured.\n\n";
        }

        instructions += "### Step 3: (Optional) Bearer Token\n";
        instructions += "For streaming and search endpoints, a Bearer Token is recommended.\n";
        instructions += 'Find it under "Keys and Tokens" > "Bearer Token".\n\n';

        instructions += "### Step 4: (Optional) Stream Keywords\n";
        instructions += "Enter comma-separated keywords to monitor in real-time via Twitter's filtered stream.\n";

        return instructions;
      });
    }

    // Register channel provider
    if (ctx.registerChannelProvider) {
      ctx.registerChannelProvider(twitterChannelProvider);
      logger.info("Registered Twitter channel provider");
    }

    // Load config
    const config = ctx.getConfig<TwitterConfig & { streamKeywords?: string }>();
    if (!config?.apiKey || !config?.accessToken) {
      logger.warn("Not configured — missing API key or access token");
      return;
    }

    // Create Twitter client
    twitterClient = new TwitterClient({
      apiKey: config.apiKey,
      apiKeySecret: config.apiKeySecret,
      accessToken: config.accessToken,
      accessTokenSecret: config.accessTokenSecret,
      bearerToken: config.bearerToken,
    });

    // Wire client into channel provider
    try {
      const me = await twitterClient.raw.v2.me();
      setTwitterProviderClient(twitterClient, me.data.username, me.data.id);
      logger.info({ msg: "Twitter client authenticated", username: me.data.username });
    } catch (err) {
      logger.error({ msg: "Twitter authentication failed", error: String(err) });
      throw err;
    }

    // Set up streaming if keywords configured
    if (config.streamKeywords) {
      streamManager = new StreamManager(twitterClient);
      const keywords = config.streamKeywords
        .split(",")
        .map((k) => k.trim())
        .filter(Boolean);
      for (const keyword of keywords) {
        await streamManager.addRule(keyword, `keyword-${keyword}`);
      }
      await streamManager.connect((tweet) => {
        logger.info({ msg: "Stream tweet received", id: tweet.data.id, text: tweet.data.text?.slice(0, 50) });
        // Emit to WOPR event bus for session handling
        if (ctx?.events?.emit) {
          ctx.events.emit(
            "twitter:stream:tweet" as never,
            {
              tweetId: tweet.data.id,
              text: tweet.data.text,
              authorId: tweet.data.author_id,
            } as never,
          );
        }
      });
    }

    logger.info("Twitter plugin initialized");
  },

  async shutdown() {
    if (streamManager) {
      await streamManager.disconnect();
      streamManager = null;
    }
    if (ctx?.unregisterSetupContextProvider) {
      ctx.unregisterSetupContextProvider();
    }
    if (ctx?.unregisterChannelProvider) {
      ctx.unregisterChannelProvider("twitter");
    }
    if (ctx?.unregisterConfigSchema) {
      ctx.unregisterConfigSchema("wopr-plugin-twitter");
    }
    clearNotificationParsers();
    setTwitterProviderClient(null);
    twitterClient = null;
    ctx = null;
    logger.info("Twitter plugin shut down");
  },
};

export default plugin;
