import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockContext } from "./mocks/wopr-context.js";

// Mock the client module to prevent real HTTP calls
vi.mock("../src/client.js", () => ({
  signalRpcRequest: vi.fn().mockResolvedValue(undefined),
  signalCheck: vi.fn().mockResolvedValue({ ok: false, status: null, error: "mocked" }),
  streamSignalEvents: vi.fn().mockResolvedValue(undefined),
}));

// Mock the daemon module to prevent spawning processes
vi.mock("../src/daemon.js", () => ({
  spawnSignalDaemon: vi.fn().mockReturnValue({ pid: 12345, stop: vi.fn() }),
  waitForSignalDaemonReady: vi.fn().mockResolvedValue(undefined),
}));

// Mock winston to avoid file system writes during tests
vi.mock("winston", () => {
  const mockLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
  return {
    default: {
      createLogger: vi.fn().mockReturnValue(mockLogger),
      format: {
        combine: vi.fn(),
        timestamp: vi.fn(),
        errors: vi.fn(),
        json: vi.fn(),
        colorize: vi.fn(),
        simple: vi.fn(),
      },
      transports: {
        File: vi.fn(),
        Console: vi.fn(),
      },
    },
  };
});

describe("signal plugin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("exports a valid WOPRPlugin object", async () => {
    const { default: plugin } = await import("../src/index.js");

    expect(plugin).toBeDefined();
    expect(plugin.name).toBe("signal");
    expect(plugin.version).toBe("1.0.0");
    expect(plugin.description).toBe("Signal integration using signal-cli");
    expect(typeof plugin.init).toBe("function");
    expect(typeof plugin.shutdown).toBe("function");
  });

  it("init registers config schema", async () => {
    const { default: plugin } = await import("../src/index.js");
    const mockCtx = createMockContext({
      getConfig: vi.fn().mockReturnValue({}),
    });

    await plugin.init(mockCtx);
    expect(mockCtx.registerConfigSchema).toHaveBeenCalledWith(
      "signal",
      expect.objectContaining({
        title: "Signal Integration",
        fields: expect.any(Array),
      }),
    );

    await plugin.shutdown();
  });

  it("init warns when no account is configured", async () => {
    const { default: plugin } = await import("../src/index.js");
    const mockCtx = createMockContext({
      getConfig: vi.fn().mockReturnValue({}),
    });

    await plugin.init(mockCtx);

    // With no account, the plugin should NOT attempt to start signal daemon
    const { signalCheck } = await import("../src/client.js");
    expect(signalCheck).not.toHaveBeenCalled();

    await plugin.shutdown();
  });

  it("init attempts to connect when account is configured", async () => {
    const { default: plugin } = await import("../src/index.js");
    const mockCtx = createMockContext({
      getConfig: vi.fn().mockReturnValue({ account: "+15551234567" }),
    });

    await plugin.init(mockCtx);

    const { signalCheck } = await import("../src/client.js");
    expect(signalCheck).toHaveBeenCalled();

    await plugin.shutdown();
  });

  it("shutdown cleans up resources", async () => {
    const { default: plugin } = await import("../src/index.js");
    const mockCtx = createMockContext({
      getConfig: vi.fn().mockReturnValue({}),
    });

    await plugin.init(mockCtx);
    await plugin.shutdown();

    // After shutdown, calling shutdown again should not throw
    await expect(plugin.shutdown()).resolves.not.toThrow();
  });

  it("refreshes agent identity on init", async () => {
    const { default: plugin } = await import("../src/index.js");
    const mockCtx = createMockContext({
      getConfig: vi.fn().mockReturnValue({}),
    });

    await plugin.init(mockCtx);

    expect(mockCtx.getAgentIdentity).toHaveBeenCalled();

    await plugin.shutdown();
  });
});
