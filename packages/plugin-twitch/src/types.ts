// Re-export all shared types
export type {
  AgentIdentity,
  ChannelCommand,
  ChannelCommandContext,
  ChannelMessageContext,
  ChannelMessageParser,
  ChannelProvider,
  ChannelRef,
  ConfigField,
  ConfigSchema,
  PluginCommand,
  PluginInjectOptions,
  PluginLogger,
  StreamMessage,
  WOPRPlugin,
  WOPRPluginContext,
} from "@wopr-network/plugin-types";

// Plugin-local types
export interface TwitchConfig {
  clientId?: string;
  clientSecret?: string;
  accessToken?: string;
  refreshToken?: string;
  channels?: string[] | string;
  commandPrefix?: string;
  broadcasterId?: string;
  enableWhispers?: boolean;
  enableChannelPoints?: boolean;
  dmPolicy?: "open" | "disabled";
}

export interface TwitchUserInfo {
  userId: string;
  username: string;
  displayName: string;
  isMod: boolean;
  isSubscriber: boolean;
  isVip: boolean;
  isBroadcaster: boolean;
  badges: Map<string, string>;
  color?: string;
}

export type { ChannelNotificationCallbacks, ChannelNotificationPayload } from "./channel-provider.js";
