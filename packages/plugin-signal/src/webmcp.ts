/**
 * WebMCP tool handlers for the Signal plugin.
 *
 * These are read-only tools that expose Signal connection state
 * and message statistics. They are registered via the manifest-driven
 * WebMCP framework (WOP-265) when the signal plugin loads.
 *
 * Security: No private keys, safety numbers, or message content is exposed.
 */

import { signalCheck, signalRpcRequest } from "./client.js";

/** Shared state injected by the plugin at init time. */
export interface SignalWebMCPState {
  getBaseUrl: () => string;
  getAccount: () => string | undefined;
  getMessageCache: () => Map<string, { isGroup: boolean; groupId?: string; from: string }>;
  isConnected: () => boolean;
}

let state: SignalWebMCPState | null = null;

export function initWebMCP(s: SignalWebMCPState): void {
  state = s;
}

export function teardownWebMCP(): void {
  state = null;
}

/**
 * WebMCP tool declarations for the plugin manifest.
 * These are the tool shapes the webui framework reads.
 */
export const webmcpToolDeclarations = [
  {
    name: "getSignalStatus",
    description:
      "Get Signal connection status including connected/disconnected state, registered account number, and linked device info.",
    parameters: {},
  },
  {
    name: "listSignalChats",
    description:
      "List active Signal conversations (individual DMs and group chats) that the bot has recently interacted with.",
    parameters: {},
  },
  {
    name: "getSignalMessageStats",
    description:
      "Get Signal message processing statistics including total messages handled and active conversation count.",
    parameters: {},
  },
];

/**
 * getSignalStatus — connection state, registered number, linked device info.
 * Does NOT expose private keys or safety numbers.
 */
async function getSignalStatus(): Promise<Record<string, unknown>> {
  if (!state) {
    return { connected: false, error: "Signal plugin not initialized" };
  }

  const baseUrl = state.getBaseUrl();
  const account = state.getAccount();

  // Check daemon connectivity
  const check = await signalCheck(baseUrl, 3000);

  if (!check.ok) {
    return {
      connected: false,
      account: account ? maskPhoneNumber(account) : null,
      daemonStatus: "unreachable",
      error: check.error,
    };
  }

  // Try to get account info via listAccounts RPC
  let accounts: Array<{ number?: string; uuid?: string; device?: number }> = [];
  try {
    const result = await signalRpcRequest("listAccounts", {}, { baseUrl, timeoutMs: 5000 });
    if (Array.isArray(result)) {
      accounts = result;
    }
  } catch (_error: unknown) {
    // listAccounts may not be supported in all signal-cli versions
  }

  // Find our account in the list
  const ownAccount = account ? accounts.find((a) => a.number === account) : accounts[0];

  return {
    connected: true,
    account: account ? maskPhoneNumber(account) : null,
    daemonStatus: "running",
    registeredDevice: ownAccount ? { deviceId: ownAccount.device ?? null } : null,
    accountCount: accounts.length,
  };
}

/**
 * listSignalChats — active conversations from the message cache.
 * Only exposes channel IDs and types, not message content.
 */
async function listSignalChats(): Promise<Record<string, unknown>> {
  if (!state) {
    return { chats: [], error: "Signal plugin not initialized" };
  }

  const cache = state.getMessageCache();
  const chatMap = new Map<string, { type: "dm" | "group"; messageCount: number }>();

  for (const msg of cache.values()) {
    const chatId = msg.isGroup && msg.groupId ? `group:${msg.groupId}` : msg.from;
    const existing = chatMap.get(chatId);
    if (existing) {
      existing.messageCount++;
    } else {
      chatMap.set(chatId, {
        type: msg.isGroup ? "group" : "dm",
        messageCount: 1,
      });
    }
  }

  const chats = Array.from(chatMap.entries()).map(([id, info]) => ({
    id,
    type: info.type,
    messageCount: info.messageCount,
  }));

  return { chats, totalChats: chats.length };
}

/**
 * getSignalMessageStats — message processing statistics.
 * Only exposes aggregate counts, not message content.
 */
async function getSignalMessageStats(): Promise<Record<string, unknown>> {
  if (!state) {
    return {
      totalMessages: 0,
      activeConversations: 0,
      error: "Signal plugin not initialized",
    };
  }

  const cache = state.getMessageCache();
  const uniqueChats = new Set<string>();

  for (const msg of cache.values()) {
    const chatId = msg.isGroup && msg.groupId ? `group:${msg.groupId}` : msg.from;
    uniqueChats.add(chatId);
  }

  return {
    totalMessages: cache.size,
    activeConversations: uniqueChats.size,
    dmConversations: Array.from(cache.values()).filter((m) => !m.isGroup).length,
    groupConversations: Array.from(cache.values()).filter((m) => m.isGroup).length,
  };
}

/**
 * Returns the runtime handler map for the webui framework to wire up.
 */
export function getWebMCPHandlers(): Record<string, () => Promise<Record<string, unknown>>> {
  return {
    getSignalStatus,
    listSignalChats,
    getSignalMessageStats,
  };
}

/**
 * Mask a phone number for display — shows country code + last 4 digits.
 * e.g., "+15551234567" -> "+1***4567"
 */
function maskPhoneNumber(phone: string): string {
  if (phone.length <= 5) return "****";
  const countryEnd = phone.startsWith("+") ? (phone.length > 11 ? 2 : 1) : 0;
  const prefix = phone.slice(0, countryEnd + 1);
  const suffix = phone.slice(-4);
  return `${prefix}***${suffix}`;
}
