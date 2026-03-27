import { describe, it, vi } from "vitest";

// Mock modules to prevent real I/O
vi.mock("../src/client.js", () => ({
  signalRpcRequest: vi.fn().mockResolvedValue(undefined),
  signalCheck: vi.fn().mockResolvedValue({ ok: false, status: null, error: "mocked" }),
  streamSignalEvents: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../src/daemon.js", () => ({
  spawnSignalDaemon: vi.fn().mockReturnValue({ pid: 12345, stop: vi.fn() }),
  waitForSignalDaemonReady: vi.fn().mockResolvedValue(undefined),
}));

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

describe("shutdown idempotency", () => {
  it("does not throw when called twice without init", async () => {
    const { default: plugin } = await import("../src/index.js");
    // Shutdown without ever calling init — should be a no-op
    await plugin.shutdown();
    await plugin.shutdown();
    // No throw = pass
  });
});
