import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock Twurple modules before importing plugin
vi.mock("@twurple/auth", () => {
  const RefreshingAuthProvider = vi.fn(function (this: Record<string, unknown>) {
    this.addUserForToken = vi.fn().mockResolvedValue(undefined);
    this.onRefresh = vi.fn();
  });
  return {
    RefreshingAuthProvider,
    getTokenInfo: vi.fn().mockResolvedValue({ userId: "bot123", userName: "botname" }),
  };
});

vi.mock("@twurple/chat", () => {
  const ChatClient = vi.fn(function (this: Record<string, unknown>) {
    let connectCb: (() => void) | null = null;
    this.onMessage = vi.fn();
    this.onWhisper = vi.fn();
    this.onSub = vi.fn();
    this.onResub = vi.fn();
    this.onRaid = vi.fn();
    this.onConnect = vi.fn().mockImplementation((cb: () => void) => {
      connectCb = cb;
    });
    this.onDisconnect = vi.fn();
    this.connect = vi.fn().mockImplementation(() => {
      if (connectCb) setTimeout(connectCb, 0);
    });
    this.quit = vi.fn();
    this.say = vi.fn().mockResolvedValue(undefined);
  });
  return { ChatClient };
});

vi.mock("@twurple/api", () => {
  const ApiClient = vi.fn(function (this: Record<string, unknown>) {
    this.whispers = { sendWhisper: vi.fn() };
    this.channelPoints = { updateRedemptionStatusByIds: vi.fn() };
  });
  return { ApiClient };
});

vi.mock("@twurple/eventsub-ws", () => {
  const EventSubWsListener = vi.fn(function (this: Record<string, unknown>) {
    this.onChannelRedemptionAdd = vi.fn();
    this.start = vi.fn().mockResolvedValue(undefined);
    this.stop = vi.fn();
  });
  return { EventSubWsListener };
});

// Dynamic import to pick up mocks
const loadPlugin = async () => {
  vi.resetModules();
  const mod = await import("../../src/index.js");
  return mod.default;
};

const makeCtx = (configOverrides: Record<string, unknown> = {}) => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  logMessage: vi.fn(),
  inject: vi.fn().mockResolvedValue("response"),
  getConfig: vi.fn().mockReturnValue({
    clientId: "test-client-id",
    clientSecret: "test-secret",
    accessToken: "test-token",
    refreshToken: "test-refresh",
    channels: "testchannel",
    commandPrefix: "!",
    ...configOverrides,
  }),
  saveConfig: vi.fn().mockResolvedValue(undefined),
  registerConfigSchema: vi.fn(),
  unregisterConfigSchema: vi.fn(),
  registerChannelProvider: vi.fn(),
  unregisterChannelProvider: vi.fn(),
  events: { on: vi.fn().mockReturnValue(() => {}), off: vi.fn(), emit: vi.fn() },
  hooks: { on: vi.fn().mockReturnValue(() => {}), off: vi.fn() },
  storage: {} as never,
  getPluginDir: vi.fn().mockReturnValue("/tmp/twitch"),
});

describe("wopr-plugin-twitch lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("has correct name and version", async () => {
    const plugin = await loadPlugin();
    expect(plugin.name).toBe("@wopr-network/wopr-plugin-twitch");
    expect(plugin.version).toBe("1.0.0");
  });

  it("has a manifest with required fields", async () => {
    const plugin = await loadPlugin();
    expect(plugin.manifest).toBeDefined();
    expect(plugin.manifest.capabilities).toContain("channel");
    expect(plugin.manifest.category).toBe("communication");
    expect(plugin.manifest.tags).toContain("twitch");
    expect(plugin.manifest.icon).toBe("🎮");
    expect(plugin.manifest.lifecycle).toBeDefined();
    expect(plugin.manifest.configSchema).toBeDefined();
  });

  it("init registers config schema and channel provider", async () => {
    const plugin = await loadPlugin();
    const ctx = makeCtx();
    await plugin.init(ctx as never);

    expect(ctx.registerConfigSchema).toHaveBeenCalledWith("wopr-plugin-twitch", expect.any(Object));
    expect(ctx.registerChannelProvider).toHaveBeenCalledWith(
      expect.objectContaining({ id: "twitch" }),
    );
  });

  it("init warns and returns early when not configured", async () => {
    const plugin = await loadPlugin();
    const ctx = makeCtx();
    ctx.getConfig.mockReturnValue({});
    await plugin.init(ctx as never);

    expect(ctx.log.warn).toHaveBeenCalledWith(expect.stringContaining("not configured"));
    expect(ctx.registerChannelProvider).not.toHaveBeenCalled();
  });

  it("shutdown unregisters config schema and channel provider", async () => {
    const plugin = await loadPlugin();
    const ctx = makeCtx();
    await plugin.init(ctx as never);

    await plugin.shutdown();

    expect(ctx.unregisterChannelProvider).toHaveBeenCalledWith("twitch");
    expect(ctx.unregisterConfigSchema).toHaveBeenCalledWith("wopr-plugin-twitch");
  });

  it("shutdown is idempotent (calling twice does not throw)", async () => {
    const plugin = await loadPlugin();
    const ctx = makeCtx();
    await plugin.init(ctx as never);

    await plugin.shutdown();
    await expect(plugin.shutdown()).resolves.not.toThrow();
  });

  it("config schema has secret fields for credentials", async () => {
    const plugin = await loadPlugin();
    const schema = plugin.manifest.configSchema;
    const secretFields = schema.fields.filter((f: { secret?: boolean }) => f.secret);
    const secretNames = secretFields.map((f: { name: string }) => f.name);

    expect(secretNames).toContain("clientSecret");
    expect(secretNames).toContain("accessToken");
    expect(secretNames).toContain("refreshToken");
  });

  it("config schema has setupFlow on credential fields", async () => {
    const plugin = await loadPlugin();
    const schema = plugin.manifest.configSchema;
    const accessTokenField = schema.fields.find((f: { name: string }) => f.name === "accessToken");
    expect(accessTokenField.setupFlow).toBe("oauth");
    expect(accessTokenField.oauthProvider).toBe("twitch");
  });
});
