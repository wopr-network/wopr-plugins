import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Mock winston before importing source
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

vi.mock("../src/client.js", () => ({
  signalRpcRequest: vi.fn().mockResolvedValue(undefined),
  signalCheck: vi.fn().mockResolvedValue({ ok: false, status: null, error: "mocked" }),
  streamSignalEvents: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../src/daemon.js", () => ({
  spawnSignalDaemon: vi.fn().mockReturnValue({ pid: 12345, stop: vi.fn() }),
  waitForSignalDaemonReady: vi.fn().mockResolvedValue(undefined),
}));

import type { SignalEvent } from "../src/client.js";
import plugin, { normalizeE164, parseSignalEvent } from "../src/index.js";
import { createMockContext } from "./mocks/wopr-context.js";

describe("normalizeE164", () => {
  it("returns null for empty string", () => {
    expect(normalizeE164("")).toBeNull();
  });

  it("returns null for non-numeric input", () => {
    expect(normalizeE164("abc")).toBeNull();
  });

  it("preserves leading + sign", () => {
    expect(normalizeE164("+15551234567")).toBe("+15551234567");
  });

  it("adds leading + when missing", () => {
    expect(normalizeE164("15551234567")).toBe("+15551234567");
  });

  it("strips formatting characters", () => {
    expect(normalizeE164("+1 (555) 123-4567")).toBe("+15551234567");
  });

  it("handles number with dashes", () => {
    expect(normalizeE164("+1-555-123-4567")).toBe("+15551234567");
  });

  it("handles number with dots", () => {
    expect(normalizeE164("+1.555.123.4567")).toBe("+15551234567");
  });
});

describe("parseSignalEvent", () => {
  // parseSignalEvent uses the module-level logger which is initialized during init()
  beforeAll(async () => {
    const mockCtx = createMockContext({ getConfig: vi.fn().mockReturnValue({}) });
    await plugin.init(mockCtx);
  });

  afterAll(async () => {
    await plugin.shutdown();
  });

  it("returns null when event has no data", () => {
    const event: SignalEvent = { event: "message" };
    expect(parseSignalEvent(event)).toBeNull();
  });

  it("returns null for non-message events", () => {
    const event: SignalEvent = {
      event: "typing",
      data: JSON.stringify({ envelope: { source: "+15551111111" } }),
    };
    expect(parseSignalEvent(event)).toBeNull();
  });

  it("returns null when envelope is missing", () => {
    const event: SignalEvent = {
      event: "message",
      data: JSON.stringify({}),
    };
    expect(parseSignalEvent(event)).toBeNull();
  });

  it("returns null for invalid JSON data", () => {
    const event: SignalEvent = {
      event: "message",
      data: "not-json",
    };
    expect(parseSignalEvent(event)).toBeNull();
  });

  it("returns null for sync messages (our own sent messages)", () => {
    const event: SignalEvent = {
      event: "message",
      data: JSON.stringify({
        envelope: {
          source: "+15551111111",
          syncMessage: {
            sentMessage: { message: "test" },
          },
        },
      }),
    };
    expect(parseSignalEvent(event)).toBeNull();
  });

  it("parses a direct message", () => {
    const event: SignalEvent = {
      event: "message",
      data: JSON.stringify({
        envelope: {
          source: "+15551111111",
          sourceName: "Alice",
          sourceNumber: "+15551111111",
          sourceUuid: "uuid-alice",
          timestamp: 1700000000000,
          dataMessage: {
            message: "Hello WOPR",
          },
        },
      }),
    };

    const result = parseSignalEvent(event);
    expect(result).not.toBeNull();
    expect(result?.from).toBe("+15551111111");
    expect(result?.text).toBe("Hello WOPR");
    expect(result?.isGroup).toBe(false);
    expect(result?.sender).toBe("Alice");
    expect(result?.senderNumber).toBe("+15551111111");
    expect(result?.senderUuid).toBe("uuid-alice");
    expect(result?.timestamp).toBe(1700000000000);
    expect(result?.fromMe).toBe(false);
  });

  it("parses a group message", () => {
    const event: SignalEvent = {
      event: "message",
      data: JSON.stringify({
        envelope: {
          source: "+15552222222",
          sourceName: "Bob",
          timestamp: 1700000000000,
          dataMessage: {
            message: "Hi everyone",
            groupInfo: {
              groupId: "group-123",
            },
          },
        },
      }),
    };

    const result = parseSignalEvent(event);
    expect(result).not.toBeNull();
    expect(result?.isGroup).toBe(true);
    expect(result?.groupId).toBe("group-123");
    expect(result?.text).toBe("Hi everyone");
  });

  it("parses message with attachments", () => {
    const event: SignalEvent = {
      event: "message",
      data: JSON.stringify({
        envelope: {
          source: "+15553333333",
          timestamp: 1700000000000,
          dataMessage: {
            message: "Check this out",
            attachments: [
              {
                id: "att-1",
                contentType: "image/png",
                filename: "photo.png",
                size: 1024,
              },
            ],
          },
        },
      }),
    };

    const result = parseSignalEvent(event);
    expect(result).not.toBeNull();
    expect(result?.attachments).toHaveLength(1);
    expect(result?.attachments?.[0]).toEqual({
      id: "att-1",
      contentType: "image/png",
      filename: "photo.png",
      size: 1024,
    });
  });

  it("parses message with quote", () => {
    const event: SignalEvent = {
      event: "message",
      data: JSON.stringify({
        envelope: {
          source: "+15554444444",
          timestamp: 1700000000000,
          dataMessage: {
            message: "I agree",
            quote: {
              text: "Original message",
              author: "+15551111111",
            },
          },
        },
      }),
    };

    const result = parseSignalEvent(event);
    expect(result).not.toBeNull();
    expect(result?.quote).toEqual({
      text: "Original message",
      author: "+15551111111",
    });
  });

  it("generates a deterministic message ID from timestamp and source", () => {
    const event: SignalEvent = {
      event: "message",
      data: JSON.stringify({
        envelope: {
          source: "+15551111111",
          timestamp: 1700000000000,
          dataMessage: { message: "test" },
        },
      }),
    };

    const result = parseSignalEvent(event);
    expect(result).not.toBeNull();
    expect(result?.id).toBe("1700000000000-+15551111111");
  });

  it("handles empty message text", () => {
    const event: SignalEvent = {
      event: "message",
      data: JSON.stringify({
        envelope: {
          source: "+15551111111",
          timestamp: 1700000000000,
          dataMessage: {},
        },
      }),
    };

    const result = parseSignalEvent(event);
    expect(result).not.toBeNull();
    expect(result?.text).toBe("");
  });
});
