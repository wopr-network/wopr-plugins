import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock snoowrap before importing plugin
vi.mock("snoowrap", () => {
  class MockSnoowrap {
    config = vi.fn();
  }
  return {
    default: MockSnoowrap,
  };
});

// Mock the logger to suppress output
vi.mock("../logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock channel-provider setters
vi.mock("../channel-provider.js", () => ({
  redditChannelProvider: { id: "reddit" },
  setRedditClient: vi.fn(),
  setBotUsername: vi.fn(),
  setDefaultSubject: vi.fn(),
}));

// Mock RedditClient
vi.mock("../reddit-client.js", () => ({
  RedditClient: class MockRedditClient {},
}));

// Mock RedditPoller — track calls via module-level spies on the prototype
const mockPollerStop = vi.fn();
const mockPollerStart = vi.fn();
vi.mock("../poller.js", () => {
  class MockRedditPoller {
    start() {
      mockPollerStart();
    }
    stop() {
      mockPollerStop();
    }
  }
  return { RedditPoller: MockRedditPoller };
});

// Mock RedditPoster
vi.mock("../poster.js", () => ({
  RedditPoster: class MockRedditPoster {},
}));

// Mock validation
vi.mock("../validation.js", () => ({
  subredditListSchema: {
    parse: (v: string) =>
      v
        .split(",")
        .map((s: string) => s.trim())
        .filter(Boolean),
  },
  pollIntervalSchema: { parse: (v: unknown) => Number(v) || 30 },
}));

import type { WOPRPlugin, WOPRPluginContext } from "../types.js";

type FullPlugin = Required<Pick<WOPRPlugin, "init" | "shutdown">>;

async function importPlugin(): Promise<FullPlugin> {
  return (await import("../index.js")).default as unknown as FullPlugin;
}

function makeContext(config: Record<string, unknown> = {}): WOPRPluginContext {
  return {
    registerConfigSchema: vi.fn(),
    registerSetupContextProvider: vi.fn(),
    registerChannelProvider: vi.fn(),
    registerExtension: vi.fn(),
    unregisterSetupContextProvider: vi.fn(),
    unregisterChannelProvider: vi.fn(),
    unregisterExtension: vi.fn(),
    unregisterConfigSchema: vi.fn(),
    getConfig: vi.fn().mockReturnValue(config),
    getSessions: vi.fn().mockReturnValue([]),
  } as unknown as WOPRPluginContext;
}

const fullConfig = {
  clientId: "test-id",
  clientSecret: "test-secret",
  refreshToken: "test-token",
  username: "test-bot",
  subreddits: "typescript,javascript",
  monitorInbox: true,
  pollIntervalSeconds: 30,
};

describe("plugin double-init guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPollerStop.mockClear();
    mockPollerStart.mockClear();
  });

  it("should auto-shutdown before re-init when init() called twice", async () => {
    // Dynamic import to get fresh module per test — but module-level state persists
    const plugin = await importPlugin();

    const ctx1 = makeContext(fullConfig);
    const ctx2 = makeContext(fullConfig);

    await plugin.init(ctx1);
    expect(mockPollerStart).toHaveBeenCalledTimes(1);

    // Second init without explicit shutdown
    await plugin.init(ctx2);

    // Old poller should have been stopped (via auto-shutdown)
    expect(mockPollerStop).toHaveBeenCalledTimes(1);
    // New poller should have been started
    expect(mockPollerStart).toHaveBeenCalledTimes(2);
  });

  it("should not auto-shutdown on first init", async () => {
    const plugin = await importPlugin();

    // Shutdown first to reset state from prior test
    await plugin.shutdown();
    mockPollerStop.mockClear();
    mockPollerStart.mockClear();

    const ctx = makeContext(fullConfig);
    await plugin.init(ctx);

    // stop should NOT have been called (no prior init to clean up)
    expect(mockPollerStop).toHaveBeenCalledTimes(0);
    expect(mockPollerStart).toHaveBeenCalledTimes(1);
  });

  it("should allow init after explicit shutdown", async () => {
    const plugin = await importPlugin();

    // Reset from prior tests
    await plugin.shutdown();
    mockPollerStop.mockClear();
    mockPollerStart.mockClear();

    const ctx1 = makeContext(fullConfig);
    await plugin.init(ctx1);
    await plugin.shutdown();

    mockPollerStop.mockClear();
    mockPollerStart.mockClear();

    const ctx2 = makeContext(fullConfig);
    await plugin.init(ctx2);

    // No auto-shutdown stop call — only the explicit shutdown above
    expect(mockPollerStop).toHaveBeenCalledTimes(0);
    expect(mockPollerStart).toHaveBeenCalledTimes(1);
  });
});
