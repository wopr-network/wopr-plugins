/**
 * Mock WOPRPluginContext for testing wopr-plugin-signal.
 */

import type { AgentIdentity, WOPRPluginContext } from "@wopr-network/plugin-types";
import { vi } from "vitest";

export function createMockContext(overrides: Partial<WOPRPluginContext> = {}): WOPRPluginContext {
  const configStore: Record<string, any> = {
    ...(overrides as any)._configData,
  };

  return {
    inject: vi.fn().mockResolvedValue("Mock response"),
    logMessage: vi.fn(),
    injectPeer: vi.fn().mockResolvedValue("Mock peer response"),
    getIdentity: vi.fn().mockReturnValue({
      publicKey: "mock-public-key",
      shortId: "mock-short-id",
      encryptPub: "mock-encrypt-pub",
    }),
    getAgentIdentity: vi.fn().mockResolvedValue({
      name: "TestAgent",
      creature: "owl",
      vibe: "chill",
      emoji: "🦉",
    } as AgentIdentity),
    getUserProfile: vi.fn().mockResolvedValue({
      name: "Test User",
      preferredAddress: "test@example.com",
    }),
    getSessions: vi.fn().mockReturnValue([]),
    getPeers: vi.fn().mockReturnValue([]),
    getConfig: vi.fn(() => ({ ...configStore })),
    saveConfig: vi.fn(async (config: any) => {
      Object.assign(configStore, config);
    }),
    getMainConfig: vi.fn().mockReturnValue({}),
    registerConfigSchema: vi.fn(),
    getPluginDir: vi.fn().mockReturnValue("/tmp/wopr-test/plugins/signal"),
    log: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
    events: {
      on: vi.fn(),
      once: vi.fn(),
      off: vi.fn(),
      emit: vi.fn(),
      emitCustom: vi.fn(),
      listenerCount: vi.fn().mockReturnValue(0),
    } as any,
    getProviders: vi.fn().mockResolvedValue([]),
    setSessionProvider: vi.fn().mockResolvedValue(undefined),
    cancelInject: vi.fn().mockReturnValue(false),
    registerChannelProvider: vi.fn(),
    unregisterChannelProvider: vi.fn(),
    registerExtension: vi.fn(),
    unregisterExtension: vi.fn(),
    getExtension: vi.fn().mockReturnValue(undefined),
    on: vi.fn(),
    off: vi.fn(),
    ...overrides,
  } as unknown as WOPRPluginContext;
}
