import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

// Mock socket.io-client (must be before plugin import)
vi.mock("socket.io-client", () => {
  const mockSocket = {
    on: vi.fn().mockImplementation((event: string, handler: () => void) => {
      if (event === "connect") handler();
    }),
    emit: vi.fn(),
    disconnect: vi.fn(),
    removeAllListeners: vi.fn(),
    connected: true,
  };
  return {
    io: vi.fn().mockReturnValue(mockSocket),
  };
});

// Mock winston
vi.mock("winston", () => {
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
  class MockFile {}
  class MockConsole {}
  const winston = {
    createLogger: vi.fn().mockReturnValue(logger),
    format: {
      combine: vi.fn().mockReturnValue({}),
      timestamp: vi.fn().mockReturnValue({}),
      errors: vi.fn().mockReturnValue({}),
      json: vi.fn().mockReturnValue({}),
      colorize: vi.fn().mockReturnValue({}),
      simple: vi.fn().mockReturnValue({}),
    },
    transports: {
      File: MockFile,
      Console: MockConsole,
    },
  };
  return { default: winston, ...winston };
});

import plugin, {
  isAllowed,
  isGroupChat,
  handleNewMessage,
  handleUpdatedMessage,
  sendResponse,
  resolveCredentials,
} from "../../src/index.js";

// Build a mock context
function makeMockCtx(configOverrides: Record<string, unknown> = {}) {
  const defaultConfig = {
    serverUrl: "http://192.168.1.100:1234",
    password: "test-pass",
    dmPolicy: "open",
    groupPolicy: "open",
    enableReactions: false,
    sendReadReceipts: false,
    enableAttachments: true,
    mediaMaxMb: 8,
  };
  return {
    inject: vi.fn().mockResolvedValue("Bot response"),
    logMessage: vi.fn(),
    injectPeer: vi.fn(),
    getIdentity: vi.fn().mockReturnValue({ publicKey: "pk", shortId: "sid", encryptPub: "ep" }),
    getAgentIdentity: vi.fn().mockResolvedValue({ name: "TestBot", emoji: "🤖" }),
    getUserProfile: vi.fn().mockResolvedValue({}),
    getSessions: vi.fn().mockReturnValue([]),
    getPeers: vi.fn().mockReturnValue([]),
    getConfig: vi.fn().mockReturnValue({ ...defaultConfig, ...configOverrides }),
    saveConfig: vi.fn().mockResolvedValue(undefined),
    getMainConfig: vi.fn().mockReturnValue(undefined),
    registerConfigSchema: vi.fn(),
    getPluginDir: vi.fn().mockReturnValue("/tmp/plugin-dir"),
    log: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  };
}

function makeMessage(overrides: Partial<{
  guid: string;
  text: string;
  isFromMe: boolean;
  itemType: number;
  associatedMessageGuid: string | null;
  chats: Array<{ guid: string; displayName: string }>;
  handle: { address: string };
  attachments: Array<{
    guid: string;
    transferName: string;
    totalBytes: number;
    transferState: number;
    mimeType: string;
    uti: string;
    isOutgoing: boolean;
    height: number;
    width: number;
  }>;
  associatedMessageType: string | null;
}> = {}) {
  return {
    guid: "msg-guid-1",
    text: "Hello there",
    subject: "",
    handle: { address: "+15551234567", country: "us", service: "iMessage", originalROWID: 1 },
    handleId: 1,
    chats: [{ guid: "iMessage;-;+15551234567", chatIdentifier: "+15551234567", groupId: "", displayName: "", participants: [], lastMessage: undefined }],
    attachments: [],
    associatedMessageGuid: null,
    associatedMessageType: null,
    replyToGuid: null,
    threadOriginatorGuid: null,
    dateCreated: Date.now(),
    dateDelivered: Date.now(),
    dateRead: 0,
    isFromMe: false,
    isAudioMessage: false,
    itemType: 0,
    groupActionType: 0,
    groupTitle: "",
    error: 0,
    partCount: 1,
    ...overrides,
  };
}

describe("Plugin exports", () => {
  it("has correct name", () => {
    expect(plugin.name).toBe("bluebubbles");
  });

  it("has correct version", () => {
    expect(plugin.version).toBe("1.0.0");
  });

  it("exports init and shutdown as functions", () => {
    expect(typeof plugin.init).toBe("function");
    expect(typeof plugin.shutdown).toBe("function");
  });
});

describe("Manifest fields", () => {
  it("has category set to channel", () => {
    expect(plugin.category).toBe("channel");
  });

  it("has configSchema defined", () => {
    expect(plugin.configSchema).toBeDefined();
    expect(plugin.configSchema!.fields.length).toBeGreaterThan(0);
  });

  it("has password field marked as secret", () => {
    const pwField = plugin.configSchema!.fields.find((f) => f.name === "password");
    expect(pwField).toBeDefined();
    expect(pwField!.secret).toBe(true);
  });

  it("has serverUrl and password fields with setupFlow required", () => {
    const serverUrl = plugin.configSchema!.fields.find((f) => f.name === "serverUrl");
    const password = plugin.configSchema!.fields.find((f) => f.name === "password");
    expect(serverUrl!.setupFlow).toBe("required");
    expect(password!.setupFlow).toBe("required");
  });

  it("provides channel:bluebubbles capability", () => {
    expect(plugin.provides).toContain("channel:bluebubbles");
  });

  it("has lifecycle singleton true", () => {
    expect(plugin.lifecycle?.singleton).toBe(true);
  });
});

describe("isGroupChat()", () => {
  it("returns true for iMessage group GUID (separator +)", () => {
    expect(isGroupChat("iMessage;+;chat123456789")).toBe(true);
  });

  it("returns false for iMessage DM GUID (separator -)", () => {
    expect(isGroupChat("iMessage;-;+15551234567")).toBe(false);
  });

  it("returns false for SMS DM GUID", () => {
    expect(isGroupChat("SMS;-;+15551234567")).toBe(false);
  });

  it("returns true for SMS group GUID", () => {
    expect(isGroupChat("SMS;+;chat123")).toBe(true);
  });
});

describe("isAllowed()", () => {
  beforeEach(async () => {
    // Initialize with open policies
    const ctx = makeMockCtx();
    // We need to set config before calling isAllowed
    // isAllowed reads from the module-level config, so init with a context
    // The simpler approach: test after a fresh init cycle
  });

  it("DM open policy: returns true for any address", async () => {
    const ctx = makeMockCtx({ dmPolicy: "open" });
    await plugin.init!(ctx as any);
    expect(isAllowed("+15559999999", false)).toBe(true);
    await plugin.shutdown!();
  });

  it("DM disabled policy: returns false for all", async () => {
    const ctx = makeMockCtx({ dmPolicy: "disabled" });
    await plugin.init!(ctx as any);
    expect(isAllowed("+15559999999", false)).toBe(false);
    await plugin.shutdown!();
  });

  it("DM allowlist policy: returns true for listed, false for unlisted", async () => {
    const ctx = makeMockCtx({ dmPolicy: "allowlist", allowFrom: ["+15551111111"] });
    await plugin.init!(ctx as any);
    expect(isAllowed("+15551111111", false)).toBe(true);
    expect(isAllowed("+15559999999", false)).toBe(false);
    await plugin.shutdown!();
  });

  it("Group open policy: returns true", async () => {
    const ctx = makeMockCtx({ groupPolicy: "open" });
    await plugin.init!(ctx as any);
    expect(isAllowed("+15559999999", true)).toBe(true);
    await plugin.shutdown!();
  });

  it("Group allowlist policy: returns true only for listed senders", async () => {
    const ctx = makeMockCtx({
      groupPolicy: "allowlist",
      groupAllowFrom: ["+15551111111"],
    });
    await plugin.init!(ctx as any);
    expect(isAllowed("+15551111111", true)).toBe(true);
    expect(isAllowed("+15559999999", true)).toBe(false);
    await plugin.shutdown!();
  });
});

describe("init()", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    globalThis.fetch = mockFetch;
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await plugin.shutdown!().catch(() => {});
  });

  it("registers config schema regardless of whether credentials are present", async () => {
    const ctx = makeMockCtx({ serverUrl: undefined, password: undefined });
    await plugin.init!(ctx as any);
    expect(ctx.registerConfigSchema).toHaveBeenCalledWith("bluebubbles", expect.any(Object));
  });

  it("logs warning and returns early when no credentials configured", async () => {
    const ctx = makeMockCtx({ serverUrl: undefined, password: undefined });
    await plugin.init!(ctx as any);
    // Should NOT have called fetch (no ping attempt)
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("pings server and connects socket when credentials are provided", async () => {
    mockFetch
      .mockResolvedValueOnce({ json: async () => ({ status: 200, message: "pong" }) })
      .mockResolvedValueOnce({
        json: async () => ({ status: 200, data: { private_api: false } }),
      });

    const ctx = makeMockCtx();
    await plugin.init!(ctx as any);

    // Should have called ping and getServerInfo
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/v1/ping"),
      expect.any(Object)
    );
  });

  it("resolves serverUrl from BLUEBUBBLES_URL environment variable", async () => {
    process.env.BLUEBUBBLES_URL = "http://envhost:5678";
    process.env.BLUEBUBBLES_PASSWORD = "env-password";

    mockFetch
      .mockResolvedValueOnce({ json: async () => ({ status: 200, message: "pong" }) })
      .mockResolvedValueOnce({
        json: async () => ({ status: 200, data: { private_api: false } }),
      });

    const ctx = makeMockCtx({ serverUrl: undefined, password: undefined });
    await plugin.init!(ctx as any);

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("http://envhost:5678"),
      expect.any(Object)
    );

    delete process.env.BLUEBUBBLES_URL;
    delete process.env.BLUEBUBBLES_PASSWORD;
  });
});

describe("shutdown()", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    globalThis.fetch = mockFetch;
    vi.clearAllMocks();
  });

  it("completes without error when no client was created", async () => {
    await expect(plugin.shutdown!()).resolves.not.toThrow();
  });

  it("disconnects socket after successful init", async () => {
    mockFetch
      .mockResolvedValueOnce({ json: async () => ({ status: 200, message: "pong" }) })
      .mockResolvedValueOnce({
        json: async () => ({ status: 200, data: { private_api: false } }),
      });

    const ctx = makeMockCtx();
    await plugin.init!(ctx as any);
    await plugin.shutdown!();

    // After shutdown, another shutdown should be clean
    await expect(plugin.shutdown!()).resolves.not.toThrow();
  });
});

describe("resolveCredentials()", () => {
  afterEach(async () => {
    delete process.env.BLUEBUBBLES_URL;
    delete process.env.BLUEBUBBLES_PASSWORD;
    await plugin.shutdown!().catch(() => {});
  });

  it("does not call fetch when serverUrl is missing (returns early)", async () => {
    const localFetch = vi.fn();
    globalThis.fetch = localFetch;

    const ctx = makeMockCtx({ serverUrl: undefined, password: "pw" });
    await plugin.init!(ctx as any);
    // resolveCredentials is used internally; test via init behavior
    // When no URL, init returns early without calling fetch
    expect(localFetch).not.toHaveBeenCalled();
  });
});

describe("handleNewMessage()", () => {
  let mockFetch: ReturnType<typeof vi.fn>;
  let ctx: ReturnType<typeof makeMockCtx>;

  beforeEach(async () => {
    mockFetch = vi.fn();
    globalThis.fetch = mockFetch;
    vi.clearAllMocks();

    mockFetch
      .mockResolvedValueOnce({ json: async () => ({ status: 200, message: "pong" }) })
      .mockResolvedValueOnce({
        json: async () => ({ status: 200, data: { private_api: false } }),
      });

    ctx = makeMockCtx();
    await plugin.init!(ctx as any);
  });

  afterEach(async () => {
    await plugin.shutdown!().catch(() => {});
  });

  it("calls inject with correct session key and message for a text DM from allowed sender", async () => {
    // Reset fetch for the sendText call
    mockFetch.mockResolvedValueOnce({
      json: async () => ({ status: 200, data: {} }),
    });

    const message = makeMessage({
      text: "Hello bot",
      isFromMe: false,
      chats: [{ guid: "iMessage;-;+15551234567", chatIdentifier: "+15551234567", groupId: "", displayName: "", participants: [], lastMessage: undefined }],
      handle: { address: "+15551234567", country: "us", service: "iMessage", originalROWID: 1 },
    });

    await handleNewMessage(message as any);

    expect(ctx.inject).toHaveBeenCalledWith(
      "bluebubbles-iMessage;-;+15551234567",
      expect.stringContaining("Hello bot"),
      expect.objectContaining({ from: "+15551234567" })
    );
  });

  it("skips messages where isFromMe is true (no inject call)", async () => {
    const message = makeMessage({ isFromMe: true });
    await handleNewMessage(message as any);
    expect(ctx.inject).not.toHaveBeenCalled();
  });

  it("skips messages where associatedMessageGuid is set (tapback reactions)", async () => {
    const message = makeMessage({ associatedMessageGuid: "parent-msg-guid" });
    await handleNewMessage(message as any);
    expect(ctx.inject).not.toHaveBeenCalled();
  });

  it("skips non-regular message types (itemType !== 0)", async () => {
    const message = makeMessage({ itemType: 1 }); // group rename
    await handleNewMessage(message as any);
    expect(ctx.inject).not.toHaveBeenCalled();
  });

  it("processes attachment-only message (text is Unicode object replacement char)", async () => {
    const message = makeMessage({
      text: "\ufffc",
      attachments: [
        {
          guid: "attach-guid-1",
          transferName: "photo.jpg",
          totalBytes: 1024 * 100, // 100KB, under 8MB limit
          transferState: 5,
          mimeType: "image/jpeg",
          uti: "public.jpeg",
          isOutgoing: false,
          height: 100,
          width: 100,
        },
      ],
    });

    // Mock attachment download (consumed first during handleNewMessage)
    const attachmentData = new Uint8Array([1, 2, 3]);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: { get: () => null },
      body: null,
      arrayBuffer: async () => attachmentData.buffer,
    });
    // Mock sendText (consumed after inject)
    mockFetch.mockResolvedValueOnce({ json: async () => ({ status: 200, data: {} }) });

    await handleNewMessage(message as any);

    // Should have called inject with attachment info
    expect(ctx.inject).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining("photo.jpg"),
      expect.any(Object)
    );
  });

  it("skips messages from disallowed DM sender (allowlist policy)", async () => {
    // Reinit with allowlist
    await plugin.shutdown!();
    vi.clearAllMocks();

    mockFetch
      .mockResolvedValueOnce({ json: async () => ({ status: 200, message: "pong" }) })
      .mockResolvedValueOnce({
        json: async () => ({ status: 200, data: { private_api: false } }),
      });

    ctx = makeMockCtx({
      dmPolicy: "allowlist",
      allowFrom: ["+15551111111"],
    });
    await plugin.init!(ctx as any);

    const message = makeMessage({
      text: "Hello",
      handle: { address: "+15559999999", country: "us", service: "iMessage", originalROWID: 2 },
    });

    await handleNewMessage(message as any);
    expect(ctx.inject).not.toHaveBeenCalled();
  });
});

describe("handleUpdatedMessage()", () => {
  it("does not call inject for tapback reactions (informational only)", async () => {
    const mockFetch = vi.fn();
    globalThis.fetch = mockFetch;
    mockFetch
      .mockResolvedValueOnce({ json: async () => ({ status: 200, message: "pong" }) })
      .mockResolvedValueOnce({
        json: async () => ({ status: 200, data: { private_api: false } }),
      });

    const ctx = makeMockCtx();
    await plugin.init!(ctx as any);

    const message = makeMessage({
      associatedMessageGuid: "original-msg-guid",
      associatedMessageType: "+like",
      handle: { address: "+15551234567", country: "us", service: "iMessage", originalROWID: 1 },
    });

    await handleUpdatedMessage(message as any);

    expect(ctx.inject).not.toHaveBeenCalled();
    await plugin.shutdown!();
  });
});

describe("sendResponse()", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    mockFetch = vi.fn();
    globalThis.fetch = mockFetch;
    vi.clearAllMocks();

    mockFetch
      .mockResolvedValueOnce({ json: async () => ({ status: 200, message: "pong" }) })
      .mockResolvedValueOnce({
        json: async () => ({ status: 200, data: { private_api: false } }),
      });

    const ctx = makeMockCtx();
    await plugin.init!(ctx as any);
  });

  afterEach(async () => {
    await plugin.shutdown!().catch(() => {});
  });

  it("sends short message in a single chunk", async () => {
    mockFetch.mockResolvedValueOnce({ json: async () => ({ status: 200, data: {} }) });

    await sendResponse("iMessage;-;+15551234567", "Short reply");

    const sendTextCalls = mockFetch.mock.calls.filter((call: any[]) =>
      String(call[0]).includes("/api/v1/message/text")
    );
    expect(sendTextCalls.length).toBe(1);
    const body = JSON.parse(sendTextCalls[0][1].body);
    expect(body.message).toBe("Short reply");
  });

  it("splits long message into multiple chunks at sentence boundaries", async () => {
    // Create a message that is definitely over 4000 chars
    // Each "sentence" is ~100 chars, so 50 of them = ~5000 chars total, requiring 2 chunks
    const longText =
      "This is a very long sentence that takes up some space and needs to be split. ".repeat(60);
    // longText is ~4680 chars, should need at least 2 chunks

    // Mock enough sendText responses
    for (let i = 0; i < 5; i++) {
      mockFetch.mockResolvedValueOnce({ json: async () => ({ status: 200, data: {} }) });
    }

    await sendResponse("iMessage;-;+15551234567", longText);

    const sendTextCalls = mockFetch.mock.calls.filter((call: any[]) =>
      String(call[0]).includes("/api/v1/message/text")
    );
    expect(sendTextCalls.length).toBeGreaterThan(1);
  });
});
