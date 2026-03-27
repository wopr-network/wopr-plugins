import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock snoowrap before importing plugin
vi.mock("snoowrap", () => {
  const MockSnoowrap = vi.fn().mockImplementation(function (this: any) {
    this.config = vi.fn();
  });
  return { default: MockSnoowrap };
});

vi.mock("./channel-provider.js", () => ({
  redditChannelProvider: {},
  setBotUsername: vi.fn(),
  setDefaultSubject: vi.fn(),
  setRedditClient: vi.fn(),
}));

vi.mock("./logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("./message-adapter.js", () => ({
  handleRedditEvent: vi.fn(),
}));

vi.mock("./poller.js", () => ({
  RedditPoller: vi.fn().mockImplementation(() => ({
    start: vi.fn(),
    stop: vi.fn(),
  })),
}));

vi.mock("./poster.js", () => ({
  RedditPoster: vi.fn().mockImplementation(function (this: any) {}),
}));

vi.mock("./reddit-client.js", () => ({
  RedditClient: vi.fn().mockImplementation(function (this: any) {}),
}));

function makeContext(config: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    registerConfigSchema: vi.fn(),
    registerSetupContextProvider: vi.fn(),
    registerChannelProvider: vi.fn(),
    unregisterSetupContextProvider: vi.fn(),
    unregisterChannelProvider: vi.fn(),
    unregisterExtension: vi.fn(),
    unregisterConfigSchema: vi.fn(),
    registerExtension: vi.fn(),
    getSessions: vi.fn().mockReturnValue([]),
    getConfig: vi.fn().mockReturnValue(config),
  };
}

describe("Reddit plugin init", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("leaves isInitialized false when credentials are missing", async () => {
    const { default: plugin } = await import("./index.js");

    // Ensure plugin starts fresh (shutdown resets flag)
    await plugin.shutdown?.();

    const ctx = makeContext({}); // no credentials
    await plugin.init(ctx as any);

    // Call init again — if isInitialized were incorrectly set true on early-return,
    // the second init() would auto-shutdown and warn. We assert it does NOT warn.
    const { logger } = await import("./logger.js");
    const warnSpy = logger.warn as ReturnType<typeof vi.fn>;
    warnSpy.mockClear();

    await plugin.init(ctx as any);

    expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining("already initialized"));
  });

  it("sets isInitialized true only after full initialization with credentials", async () => {
    const { default: plugin } = await import("./index.js");
    await plugin.shutdown?.();

    const ctx = makeContext({
      clientId: "id",
      clientSecret: "secret",
      refreshToken: "token",
      username: "bot",
    });

    await plugin.init(ctx as any);

    // A second init should warn about already being initialized
    const { logger } = await import("./logger.js");
    const warnSpy = logger.warn as ReturnType<typeof vi.fn>;
    warnSpy.mockClear();

    await plugin.init(ctx as any);

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("already initialized"));
  });
});
