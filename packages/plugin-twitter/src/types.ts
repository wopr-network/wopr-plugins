/**
 * Type definitions for the WOPR Twitter plugin.
 */

export type {
  ChannelCommand,
  ChannelCommandContext,
  ChannelMessageContext,
  ChannelMessageParser,
  ChannelProvider,
  ConfigField,
  ConfigSchema,
  PluginCommand,
  PluginInjectOptions,
  PluginLogger,
  SessionCreateEvent,
  SessionInjectEvent,
  SessionResponseEvent,
  StreamMessage,
  WOPRPlugin,
  WOPRPluginContext,
} from "@wopr-network/plugin-types";

/** Twitter-specific config values resolved from configSchema */
export interface TwitterConfig {
  apiKey: string;
  apiKeySecret: string;
  accessToken: string;
  accessTokenSecret: string;
  bearerToken?: string;
}

/** Rate limit state for a single endpoint family */
export interface RateLimitState {
  remaining: number;
  resetAt: number; // epoch ms
}
