import { vi } from "vitest";
import type { WOPRPluginContext } from "../types.js";

export function createMockContext(overrides: { config?: Record<string, unknown> } = {}): WOPRPluginContext {
  const events = {
    on: vi.fn().mockReturnValue(vi.fn()),
    once: vi.fn(),
    off: vi.fn(),
    emit: vi.fn().mockResolvedValue(undefined),
    emitCustom: vi.fn().mockResolvedValue(undefined),
    listenerCount: vi.fn().mockReturnValue(0),
  };
  const ctx: any = {
    inject: vi.fn().mockResolvedValue("AI response"),
    logMessage: vi.fn(),
    getAgentIdentity: vi.fn().mockResolvedValue({ name: "WOPR", emoji: "🤖" }),
    getUserProfile: vi.fn().mockResolvedValue({ name: "Test User" }),
    getSessions: vi.fn().mockReturnValue([]),
    cancelInject: vi.fn().mockReturnValue(false),
    events,
    hooks: { on: vi.fn(), off: vi.fn(), offByName: vi.fn(), list: vi.fn().mockReturnValue([]) },
    registerContextProvider: vi.fn(),
    unregisterContextProvider: vi.fn(),
    getContextProvider: vi.fn(),
    registerChannel: vi.fn(),
    unregisterChannel: vi.fn(),
    getChannel: vi.fn(),
    getChannels: vi.fn().mockReturnValue([]),
    getChannelsForSession: vi.fn().mockReturnValue([]),
    registerWebUiExtension: vi.fn(),
    unregisterWebUiExtension: vi.fn(),
    getWebUiExtensions: vi.fn().mockReturnValue([]),
    registerUiComponent: vi.fn(),
    unregisterUiComponent: vi.fn(),
    getUiComponents: vi.fn().mockReturnValue([]),
    getConfig: vi.fn().mockReturnValue(overrides.config ?? {}),
    saveConfig: vi.fn().mockResolvedValue(undefined),
    getMainConfig: vi.fn(),
    registerProvider: vi.fn(),
    unregisterProvider: vi.fn(),
    getProvider: vi.fn(),
    registerConfigSchema: vi.fn(),
    unregisterConfigSchema: vi.fn(),
    getConfigSchema: vi.fn(),
    registerExtension: vi.fn(),
    unregisterExtension: vi.fn(),
    getExtension: vi.fn(),
    listExtensions: vi.fn().mockReturnValue([]),
    registerChannelProvider: vi.fn(),
    unregisterChannelProvider: vi.fn(),
    getChannelProvider: vi.fn(),
    getChannelProviders: vi.fn().mockReturnValue([]),
    registerCapabilityProvider: vi.fn(),
    unregisterCapabilityProvider: vi.fn(),
    getCapabilityProviders: vi.fn().mockReturnValue([]),
    hasCapability: vi.fn().mockReturnValue(false),
    registerHealthProbe: vi.fn(),
    registerSetupContextProvider: vi.fn(),
    unregisterSetupContextProvider: vi.fn(),
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    storage: { getTable: vi.fn(), listTables: vi.fn() },
    getPluginDir: vi.fn().mockReturnValue("/tmp/test-plugin"),
  };
  return ctx;
}

/** Create a mock snoowrap instance */
export function createMockSnoowrap() {
  const mockSubreddit = {
    getNew: vi.fn().mockResolvedValue([]),
    getHot: vi.fn().mockResolvedValue([]),
    search: vi.fn().mockResolvedValue([]),
  };
  const snoowrap: any = {
    getSubreddit: vi.fn().mockReturnValue(mockSubreddit),
    getInbox: vi.fn().mockResolvedValue([]),
    getUnreadMessages: vi.fn().mockResolvedValue([]),
    composeMessage: vi.fn().mockResolvedValue(undefined),
    getComment: vi.fn().mockReturnValue({ reply: vi.fn().mockResolvedValue({}) }),
    getSubmission: vi.fn().mockReturnValue({
      reply: vi.fn().mockResolvedValue({}),
      selftext: "post body",
      title: "post title",
    }),
    submitSelfpost: vi.fn().mockResolvedValue({ name: "t3_abc123" }),
    submitLink: vi.fn().mockResolvedValue({ name: "t3_def456" }),
    markMessagesAsRead: vi.fn().mockResolvedValue(undefined),
    _mockSubreddit: mockSubreddit,
  };
  return snoowrap;
}
