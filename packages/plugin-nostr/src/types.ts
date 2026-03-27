// Re-export shared types from @wopr-network/plugin-types
export type {
  ChannelNotificationCallbacks,
  ChannelNotificationPayload,
  ChannelProvider,
  ChannelRef,
  ConfigField,
  ConfigSchema,
  PluginCommand,
  PluginLogger,
  StreamMessage,
  WOPREventBus,
  WOPRPlugin,
  WOPRPluginContext,
} from "@wopr-network/plugin-types";

// Plugin-specific types
export interface NostrConfig {
  nsec?: string; // Private key in nsec (bech32) or hex format
  relays?: string[]; // Relay WebSocket URLs (wss://...)
  commandPrefix?: string; // Prefix for commands in public notes (default: "!")
  enablePublicReplies?: boolean; // Respond to kind 1 mentions (default: false)
  dmPolicy?: "open" | "allowlist" | "disabled"; // DM acceptance policy
  allowedPubkeys?: string[]; // Pubkeys allowed to DM (when dmPolicy=allowlist)
  reconnectIntervalMs?: number; // Relay reconnect interval (default: 5000)
  maxReconnectAttempts?: number; // Max reconnect attempts per relay (default: 10)
}

export interface NostrEventMeta {
  id: string; // Event ID (hex)
  pubkey: string; // Sender pubkey (hex)
  kind: number; // Event kind
  createdAt: number; // Unix timestamp
  relayUrl?: string; // Which relay delivered this event
}

export interface RelayStatus {
  url: string;
  connected: boolean;
  lastError?: string;
  reconnectAttempts: number;
}

export interface NostrEvent {
  id: string;
  pubkey: string;
  kind: number;
  created_at: number;
  content: string;
  tags: string[][];
  sig: string;
}
