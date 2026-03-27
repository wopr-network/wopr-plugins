/**
 * WOPR Reddit Plugin - Orchestrator
 *
 * Wires together Reddit client, poller, poster, channel provider,
 * and message adapter. Handles OAuth2 setup and lifecycle.
 */

import Snoowrap from "snoowrap";
import {
  clearRegistrations,
  redditChannelProvider,
  setBotUsername,
  setDefaultSubject,
  setRedditClient,
} from "./channel-provider.js";
import { logger } from "./logger.js";
import { handleRedditEvent } from "./message-adapter.js";
import { RedditPoller } from "./poller.js";
import { RedditPoster } from "./poster.js";
import { RedditClient } from "./reddit-client.js";
import type { ConfigSchema, RedditPluginConfig, WOPRPlugin, WOPRPluginContext } from "./types.js";
import { pollIntervalSchema, subredditListSchema } from "./validation.js";

let ctx: WOPRPluginContext | null = null;
let redditClient: RedditClient | null = null;
let poller: RedditPoller | null = null;
let poster: RedditPoster | null = null;
let isInitialized = false;

const configSchema: ConfigSchema = {
  title: "Reddit Integration",
  description: "Configure Reddit bot integration via OAuth2 script app",
  fields: [
    {
      name: "clientId",
      type: "text",
      label: "Reddit App Client ID",
      placeholder: "From https://www.reddit.com/prefs/apps",
      required: true,
      description: "OAuth2 client ID for your Reddit script app",
    },
    {
      name: "clientSecret",
      type: "password",
      label: "Reddit App Secret",
      placeholder: "OAuth2 secret",
      required: true,
      secret: true,
      description: "OAuth2 client secret for your Reddit script app",
    },
    {
      name: "refreshToken",
      type: "password",
      label: "Refresh Token",
      placeholder: "OAuth2 refresh token",
      required: true,
      secret: true,
      description: "Permanent OAuth2 refresh token (obtain via authorization flow)",
    },
    {
      name: "username",
      type: "text",
      label: "Reddit Username",
      placeholder: "Bot's Reddit username",
      required: true,
      description: "The Reddit account username the bot operates as",
    },
    {
      name: "subreddits",
      type: "text",
      label: "Subreddits to Monitor",
      placeholder: "programming, rust, typescript",
      description: "Comma-separated list of subreddits to watch (without r/ prefix)",
    },
    {
      name: "keywords",
      type: "text",
      label: "Keywords to Watch",
      placeholder: "WOPR, AI bot",
      description: "Comma-separated keywords — only posts matching these are forwarded (leave blank for all)",
    },
    {
      name: "pollIntervalSeconds",
      type: "text",
      label: "Poll Interval (seconds)",
      placeholder: "30",
      default: "30",
      description: "How often to check for new posts (10-300 seconds)",
    },
    {
      name: "monitorInbox",
      type: "boolean",
      label: "Monitor Inbox",
      default: true,
      description: "Watch for replies, mentions, and DMs",
    },
    {
      name: "defaultSubject",
      type: "text",
      label: "Default DM/Post Subject",
      placeholder: "Leave blank to derive from message content",
      description: "Subject line for outbound DMs and self-posts (first 50 chars of content used if not set)",
    },
  ],
};

const plugin: WOPRPlugin = {
  name: "wopr-plugin-reddit",
  version: "0.1.0",
  description: "Reddit channel plugin with subreddit monitoring and posting",
  manifest: {
    name: "wopr-plugin-reddit",
    version: "0.1.0",
    description: "Reddit channel plugin with subreddit monitoring and posting",
    capabilities: ["channel"],
    category: "channel",
    tags: ["reddit", "social", "bot", "messaging"],
    icon: "🔴",
    requires: { network: { outbound: true }, env: [] },
    provides: {
      capabilities: [{ type: "channel", id: "reddit", displayName: "Reddit" }],
    },
    lifecycle: { shutdownBehavior: "graceful" },
    configSchema,
  },

  async init(context: WOPRPluginContext) {
    if (isInitialized) {
      logger.warn("Reddit plugin init() called while already initialized — auto-shutting down first");
      await plugin.shutdown?.();
    }
    ctx = context;
    ctx.registerConfigSchema("wopr-plugin-reddit", configSchema);

    // Register setup context provider for conversational setup
    if (ctx.registerSetupContextProvider) {
      ctx.registerSetupContextProvider(({ partialConfig }: { partialConfig: Record<string, unknown> }) => {
        const hasClientId = !!partialConfig.clientId;
        const hasSecret = !!partialConfig.clientSecret;
        const hasRefreshToken = !!partialConfig.refreshToken;
        const hasUsername = !!partialConfig.username;

        let instructions = `You are helping the user set up the Reddit plugin for WOPR.\n\n## Reddit Bot Setup Guide\n\n`;

        if (!hasClientId || !hasSecret) {
          instructions += `### Step 1: Create a Reddit Script App\n1. Go to https://www.reddit.com/prefs/apps\n2. Click "create another app..." at the bottom\n3. Fill in:\n   - Name: "WOPR Bot" (or any name)\n   - Type: Select **script**\n   - Redirect URI: http://localhost:8080 (not used but required)\n4. Click "create app"\n5. Copy the **client ID** (string under the app name) and the **secret**\n\nAsk the user for their client ID and secret.\n`;
        } else {
          instructions += `### Step 1: Reddit App\nClient ID and secret are configured.\n\n`;
        }

        if (!hasRefreshToken) {
          instructions += `### Step 2: Get a Refresh Token\nThe user needs a permanent OAuth2 refresh token. They can obtain one by:\n1. Using a helper tool like https://not-an-aardvark.github.io/reddit-oauth-helper/\n2. Select scopes: read, submit, privatemessages, identity\n3. Generate the token and paste it here\n\nAsk the user for their refresh token.\n`;
        } else {
          instructions += `### Step 2: Refresh Token\nRefresh token is configured.\n\n`;
        }

        if (!hasUsername) {
          instructions += `### Step 3: Reddit Username\nAsk the user for the Reddit username of the bot account.\n`;
        } else {
          instructions += `### Step 3: Username\nUsername is configured.\n\n`;
        }

        instructions += `### Step 4: Subreddit Monitoring (Optional)\nAsk the user which subreddits to monitor (comma-separated, e.g., "programming, typescript").\nThey can also set keywords to filter posts.\n`;

        return instructions;
      });
    }

    // Register channel provider
    if (ctx.registerChannelProvider) {
      ctx.registerChannelProvider(redditChannelProvider);
      logger.info("Registered Reddit channel provider");
    }

    // Load config
    const config = ctx.getConfig<RedditPluginConfig>();
    if (!config?.clientId || !config?.clientSecret || !config?.refreshToken || !config?.username) {
      logger.warn("Reddit plugin not fully configured — missing credentials");
      return;
    }

    // Create snoowrap client
    const snoowrap = new Snoowrap({
      userAgent: `WOPR Reddit Plugin v0.1.0 (by /u/${config.username})`,
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      refreshToken: config.refreshToken,
    });
    (snoowrap as any).config({ requestDelay: 1100, continueAfterRatelimitError: true });

    redditClient = new RedditClient(snoowrap);
    poster = new RedditPoster(redditClient);
    setRedditClient(redditClient);
    setBotUsername(config.username);
    setDefaultSubject(config.defaultSubject);

    // Register extension so other plugins can use poster
    if (ctx.registerExtension) {
      ctx.registerExtension("reddit", { poster, client: redditClient });
      logger.info("Registered Reddit extension");
    }

    // Parse subreddits
    let subreddits: string[] = [];
    if (config.subreddits) {
      try {
        subreddits = subredditListSchema.parse(config.subreddits);
      } catch (err) {
        logger.error({ msg: "Invalid subreddit config", error: String(err) });
      }
    }

    // Parse keywords
    let keywords: string[] = [];
    if (config.keywords) {
      keywords = config.keywords
        .split(",")
        .map((k) => k.trim().toLowerCase())
        .filter(Boolean);
    }

    // Parse poll interval
    let pollIntervalMs = 30_000;
    try {
      const seconds = pollIntervalSchema.parse(config.pollIntervalSeconds);
      pollIntervalMs = seconds * 1_000;
    } catch {
      /* use default */
    }

    // Start poller
    if (subreddits.length > 0 || config.monitorInbox) {
      poller = new RedditPoller(redditClient, {
        subreddits,
        keywords,
        pollIntervalMs,
        monitorInbox: config.monitorInbox ?? true,
        onEvent: async (event) => {
          if (!ctx) return;
          const sessions = ctx.getSessions() ?? [];
          const targets = sessions.length > 0 ? sessions : ["default"];
          for (const session of targets) {
            try {
              const consumed = await handleRedditEvent(event, ctx, session, config.username);
              if (consumed) break;
            } catch (err) {
              logger.error({ msg: "Event handling failed", error: String(err), session });
            }
          }
        },
      });
      poller.start();
      logger.info({ msg: "Reddit poller started", subreddits, keywords, pollIntervalMs });
    }

    isInitialized = true;
    logger.info({ msg: "Reddit plugin initialized", username: config.username });
  },

  async shutdown() {
    if (poller) {
      poller.stop();
      poller = null;
    }
    if (ctx?.unregisterSetupContextProvider) {
      ctx.unregisterSetupContextProvider();
    }
    if (ctx?.unregisterChannelProvider) {
      ctx.unregisterChannelProvider("reddit");
    }
    if (ctx?.unregisterExtension) {
      ctx.unregisterExtension("reddit");
    }
    if (ctx?.unregisterConfigSchema) {
      ctx.unregisterConfigSchema("wopr-plugin-reddit");
    }
    clearRegistrations();
    setRedditClient(null);
    setBotUsername("unknown");
    redditClient = null;
    poster = null;
    ctx = null;
    isInitialized = false;
    logger.info("Reddit plugin shut down");
  },
};

export default plugin;
