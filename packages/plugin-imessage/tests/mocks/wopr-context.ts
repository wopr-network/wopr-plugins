/**
 * Mock WOPRPluginContext for testing wopr-plugin-imessage.
 */

import type { PluginInjectOptions, WOPRPluginContext } from "@wopr-network/plugin-types";
import { vi } from "vitest";

export function createMockContext(overrides: Partial<WOPRPluginContext> = {}): WOPRPluginContext {
  const configStore: Record<string, any> = {
    ...(overrides as any)._configData,
  };

  const handlers = new Map<string, Function[]>();

  const mockEventBus = {
    on: vi.fn((event: string, handler: Function) => {
      if (!handlers.has(event)) handlers.set(event, []);
      handlers.get(event)?.push(handler);
      return () => {
        const list = handlers.get(event);
        if (list) {
          const idx = list.indexOf(handler);
          if (idx >= 0) list.splice(idx, 1);
        }
      };
    }),
    once: vi.fn(),
    off: vi.fn(),
    emit: vi.fn(),
    emitCustom: vi.fn(),
    listenerCount: vi.fn().mockReturnValue(0),
  };

  const mockHooks = {
    register: vi.fn(),
    unregister: vi.fn(),
    run: vi.fn().mockResolvedValue(undefined),
  };

  return {
    inject: vi.fn<[string, string, PluginInjectOptions?], Promise<string>>().mockResolvedValue("Mock response"),
    logMessage: vi.fn(),
    getAgentIdentity: vi.fn().mockResolvedValue({
      name: "TestAgent",
      creature: "owl",
      vibe: "chill",
      emoji: "🦉",
    }),
    getUserProfile: vi.fn().mockResolvedValue({
      name: "Test User",
      preferredAddress: "test@example.com",
    }),
    getSessions: vi.fn().mockReturnValue([]),
    cancelInject: vi.fn().mockReturnValue(false),
    events: mockEventBus as any,
    hooks: mockHooks as any,
    registerContextProvider: vi.fn(),
    unregisterContextProvider: vi.fn(),
    getContextProvider: vi.fn().mockReturnValue(undefined),
    registerChannel: vi.fn(),
    unregisterChannel: vi.fn(),
    getChannel: vi.fn().mockReturnValue(undefined),
    getChannels: vi.fn().mockReturnValue([]),
    getChannelsForSession: vi.fn().mockReturnValue([]),
    registerWebUiExtension: vi.fn(),
    unregisterWebUiExtension: vi.fn(),
    getWebUiExtensions: vi.fn().mockReturnValue([]),
    registerUiComponent: vi.fn(),
    unregisterUiComponent: vi.fn(),
    getUiComponents: vi.fn().mockReturnValue([]),
    getConfig: vi.fn(() => ({ ...configStore })),
    saveConfig: vi.fn(async (config: any) => {
      Object.assign(configStore, config);
    }),
    getMainConfig: vi.fn().mockReturnValue({}),
    registerLLMProvider: vi.fn(),
    unregisterLLMProvider: vi.fn(),
    getProvider: vi.fn().mockReturnValue(undefined),
    registerConfigSchema: vi.fn(),
    unregisterConfigSchema: vi.fn(),
    getConfigSchema: vi.fn().mockReturnValue(undefined),
    registerExtension: vi.fn(),
    unregisterExtension: vi.fn(),
    getExtension: vi.fn().mockReturnValue(undefined),
    listExtensions: vi.fn().mockReturnValue([]),
    registerSTTProvider: vi.fn(),
    registerTTSProvider: vi.fn(),
    getSTT: vi.fn().mockReturnValue(undefined),
    getTTS: vi.fn().mockReturnValue(undefined),
    hasVoice: vi.fn().mockReturnValue({ stt: false, tts: false }),
    registerChannelProvider: vi.fn(),
    unregisterChannelProvider: vi.fn(),
    getChannelProvider: vi.fn().mockReturnValue(undefined),
    getChannelProviders: vi.fn().mockReturnValue([]),
    log: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
    getPluginDir: vi.fn().mockReturnValue("/tmp/wopr-test/plugins/imessage"),
    ...overrides,
  };
}
