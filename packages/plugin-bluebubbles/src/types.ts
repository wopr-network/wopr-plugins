/**
 * Local type definitions for WOPR BlueBubbles Plugin
 */

import type { WOPRPluginContext } from "@wopr-network/plugin-types";

export type {
  AgentIdentity,
  PluginInjectOptions as InjectOptions,
  PluginLogger,
  StreamMessage,
  UserProfile,
} from "@wopr-network/plugin-types";

export type { WOPRPluginContext };

// BlueBubbles uses "required"/"optional" setupFlow values which differ from
// the canonical SetupFlowType in plugin-types. Keep these local until plugin-types aligns.
export interface ConfigField {
  name: string;
  type: string;
  label?: string;
  placeholder?: string;
  required?: boolean;
  description?: string;
  hidden?: boolean;
  default?: unknown;
  secret?: boolean;
  setupFlow?: "required" | "optional";
  options?: Array<{ value: string; label: string }>;
}

export interface ConfigSchema {
  title: string;
  description: string;
  fields: ConfigField[];
}

// Local WOPRPlugin with BlueBubbles-specific manifest fields not yet in plugin-types
export interface WOPRPlugin {
  name: string;
  version: string;
  description: string;
  category?: string;
  tags?: string[];
  icon?: string;
  capabilities?: string[];
  provides?: string[];
  requires?: Record<string, unknown>;
  lifecycle?: { singleton?: boolean };
  configSchema?: ConfigSchema;
  init?: (context: WOPRPluginContext) => Promise<void>;
  shutdown?: () => Promise<void>;
}

export interface ChannelInfo {
  type: string;
  id: string;
  name?: string;
}

export interface LogMessageOptions {
  from?: string;
  channel?: ChannelInfo;
}

// BlueBubbles API types

export interface BBMessage {
  guid: string;
  text: string;
  subject: string;
  handle: BBHandle;
  handleId: number;
  chats: BBChat[];
  attachments: BBAttachment[];
  associatedMessageGuid: string | null;
  associatedMessageType: string | null;
  replyToGuid: string | null;
  threadOriginatorGuid: string | null;
  dateCreated: number;
  dateDelivered: number;
  dateRead: number;
  isFromMe: boolean;
  isAudioMessage: boolean;
  itemType: number;
  groupActionType: number;
  groupTitle: string;
  error: number;
  partCount: number;
}

export interface BBChat {
  guid: string;
  chatIdentifier: string;
  groupId: string;
  displayName: string;
  participants: BBParticipant[];
  lastMessage?: BBMessage;
}

export interface BBHandle {
  address: string;
  country: string;
  service: string;
  originalROWID: number;
}

export interface BBAttachment {
  guid: string;
  uti: string;
  mimeType: string;
  transferName: string;
  totalBytes: number;
  transferState: number;
  isOutgoing: boolean;
  height: number;
  width: number;
}

export interface BBParticipant {
  address: string;
}

export interface BBApiResponse<T = any> {
  status: number;
  message: string;
  data?: T;
  error?: { type: string; error: string };
}

export interface BBTypingNotification {
  display: boolean;
  guid: string;
}

export interface BlueBubblesConfig {
  serverUrl?: string;
  password?: string;
  dmPolicy?: "allowlist" | "pairing" | "open" | "disabled";
  allowFrom?: string[];
  groupPolicy?: "allowlist" | "open" | "disabled";
  groupAllowFrom?: string[];
  mediaMaxMb?: number;
  sendReadReceipts?: boolean;
  enableReactions?: boolean;
  enableAttachments?: boolean;
  commandPrefix?: string;
}
