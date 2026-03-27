/**
 * Mock WOPRPluginContext for testing wopr-plugin-nostr.
 */
import { vi } from "vitest";
import type { WOPRPluginContext, WOPREventBus } from "../../src/types.js";

// ---------------------------------------------------------------------------
// Mock Event Bus
// ---------------------------------------------------------------------------
export function createMockEventBus(overrides: Partial<WOPREventBus> = {}): WOPREventBus {
  const handlers = new Map<string, Function[]>();
  return {
    on: vi.fn((event: string, handler: Function) => {
      if (!handlers.has(event)) handlers.set(event, []);
      handlers.get(event)!.push(handler);
      return () => {
        const list = handlers.get(event);
        if (list) {
          const idx = list.indexOf(handler);
          if (idx >= 0) list.splice(idx, 1);
        }
      };
    }),
    once: vi.fn((event: string, handler: Function) => {
      if (!handlers.has(event)) handlers.set(event, []);
      const wrapper = (...args: unknown[]) => {
        const list = handlers.get(event);
        if (list) {
          const idx = list.indexOf(wrapper);
          if (idx >= 0) list.splice(idx, 1);
        }
        return handler(...args);
      };
      handlers.get(event)!.push(wrapper);
      return () => {
        const list = handlers.get(event);
        if (list) {
          const idx = list.indexOf(wrapper);
          if (idx >= 0) list.splice(idx, 1);
        }
      };
    }),
    off: vi.fn((event: string, handler: Function) => {
      const list = handlers.get(event);
      if (list) {
        const idx = list.indexOf(handler);
        if (idx >= 0) list.splice(idx, 1);
      }
    }),
    emit: vi.fn(async (event: string, payload: unknown) => {
      const list = handlers.get(event) || [];
      for (const h of list) await h(payload, { type: event, payload, timestamp: Date.now() });
    }),
    emitCustom: vi.fn(async (event: string, payload: unknown) => {
      const list = handlers.get(event) || [];
      for (const h of list) await h(payload, { type: event, payload, timestamp: Date.now() });
    }),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Mock WOPRPluginContext
// ---------------------------------------------------------------------------
export function createMockContext(overrides: Partial<WOPRPluginContext> = {}): WOPRPluginContext {
  const configStore: Record<string, unknown> = {};

  return {
    inject: vi.fn().mockResolvedValue("Mock response"),
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
    getConfig: vi.fn(() => ({ ...configStore })),
    saveConfig: vi.fn(async (config: Record<string, unknown>) => {
      Object.assign(configStore, config);
    }),
    getMainConfig: vi.fn().mockReturnValue({}),
    registerConfigSchema: vi.fn(),
    unregisterConfigSchema: vi.fn(),
    getConfigSchema: vi.fn().mockReturnValue(undefined),
    getPluginDir: vi.fn().mockReturnValue("/tmp/wopr-test/plugins/nostr"),
    log: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
    events: createMockEventBus(),
    hooks: {
      on: vi.fn(),
      off: vi.fn(),
      offByName: vi.fn(),
    } as never,
    storage: {
      register: vi.fn(),
      getRepository: vi.fn(),
    } as never,
    cancelInject: vi.fn().mockReturnValue(false),
    registerChannelProvider: vi.fn(),
    unregisterChannelProvider: vi.fn(),
    getChannelProvider: vi.fn().mockReturnValue(undefined),
    getChannelProviders: vi.fn().mockReturnValue([]),
    registerExtension: vi.fn(),
    unregisterExtension: vi.fn(),
    getExtension: vi.fn().mockReturnValue(undefined),
    listExtensions: vi.fn().mockReturnValue([]),
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
    registerLLMProvider: vi.fn(),
    unregisterLLMProvider: vi.fn(),
    getProvider: vi.fn().mockReturnValue(undefined),
    registerSTTProvider: vi.fn(),
    registerTTSProvider: vi.fn(),
    getSTT: vi.fn().mockReturnValue(undefined),
    getTTS: vi.fn().mockReturnValue(undefined),
    hasVoice: vi.fn().mockReturnValue({ stt: false, tts: false }),
    registerA2AServer: vi.fn(),
    ...overrides,
  } as WOPRPluginContext;
}
