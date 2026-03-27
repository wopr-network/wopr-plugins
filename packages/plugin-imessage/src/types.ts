/**
 * Type definitions for WOPR iMessage Plugin
 *
 * Shared types are imported from @wopr-network/plugin-types.
 * Only plugin-specific types are defined here.
 */

// Re-export shared types that consumers of this module use
export type {
  AgentIdentity,
  ChannelRef,
  ConfigField,
  ConfigSchema,
  PluginInjectOptions,
  PluginLogger,
  StreamMessage,
  UserProfile,
  WOPRPlugin,
  WOPRPluginContext,
} from "@wopr-network/plugin-types";

// iMessage-specific types
export interface IMessageConfig {
  enabled?: boolean;
  cliPath?: string; // Path to imsg CLI (default: "imsg")
  dbPath?: string; // Path to Messages DB (default: ~/Library/Messages/chat.db)
  service?: "imessage" | "sms" | "auto";
  region?: string; // SMS region (default: "US")

  // DM settings
  dmPolicy?: "pairing" | "open" | "closed" | "allowlist";
  allowFrom?: string[]; // Handles/emails/chat_ids for allowlist

  // Group settings
  groupPolicy?: "allowlist" | "open" | "disabled";
  groupAllowFrom?: string[];

  // Media
  includeAttachments?: boolean;
  mediaMaxMb?: number;

  // Text chunking
  textChunkLimit?: number;
}

// JSON-RPC types for imsg CLI
export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: Record<string, any>;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number;
  result?: any;
  error?: {
    code: number;
    message: string;
    data?: any;
  };
}

export interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: Record<string, any>;
}

// Incoming iMessage from imsg CLI
export interface IncomingMessage {
  text: string;
  sender: string;
  handle?: string;
  chat_id?: number;
  chat_guid?: string;
  chat_identifier?: string;
  is_group?: boolean;
  service?: string;
  timestamp?: string;
  message_id?: string;
}
