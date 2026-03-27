import { vi } from "vitest";

export function createMockContext(overrides: Record<string, unknown> = {}) {
  return {
    getConfig: vi.fn().mockReturnValue({}),
    registerConfigSchema: vi.fn(),
    saveConfig: vi.fn().mockResolvedValue(undefined),
    getPluginDir: vi.fn().mockReturnValue("/tmp/wopr-matrix-test"),
    logMessage: vi.fn(),
    inject: vi.fn().mockResolvedValue(undefined),
    log: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
    events: {
      on: vi.fn().mockReturnValue(() => {}),
      once: vi.fn().mockReturnValue(() => {}),
      emitCustom: vi.fn().mockResolvedValue(undefined),
    },
    hooks: {
      on: vi.fn().mockReturnValue(() => {}),
      off: vi.fn(),
    },
    storage: {
      register: vi.fn().mockResolvedValue(undefined),
      getRepository: vi.fn().mockReturnValue({}),
    },
    registerChannelProvider: vi.fn(),
    unregisterChannelProvider: vi.fn(),
    registerExtension: vi.fn(),
    unregisterExtension: vi.fn(),
    getExtension: vi.fn().mockReturnValue(undefined),
    registerA2AServer: vi.fn(),
    ...overrides,
  };
}
