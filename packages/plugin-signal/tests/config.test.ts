import { describe, expect, it, vi } from "vitest";

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

import { configSchema } from "../src/index.js";

describe("configSchema", () => {
  it("has required title and description", () => {
    expect(configSchema.title).toBe("Signal Integration");
    expect(configSchema.description).toBe("Configure Signal integration using signal-cli");
  });

  it("has fields array with entries", () => {
    expect(Array.isArray(configSchema.fields)).toBe(true);
    expect(configSchema.fields.length).toBeGreaterThan(0);
  });

  it("includes account field", () => {
    const accountField = configSchema.fields.find((f) => f.name === "account");
    expect(accountField).toBeDefined();
    expect(accountField?.type).toBe("text");
    expect(accountField?.label).toBe("Signal Account");
  });

  it("includes cliPath field with default", () => {
    const cliPathField = configSchema.fields.find((f) => f.name === "cliPath");
    expect(cliPathField).toBeDefined();
    expect(cliPathField?.type).toBe("text");
    expect(cliPathField?.default).toBe("signal-cli");
  });

  it("includes httpHost field with default", () => {
    const httpHostField = configSchema.fields.find((f) => f.name === "httpHost");
    expect(httpHostField).toBeDefined();
    expect(httpHostField?.default).toBe("127.0.0.1");
  });

  it("includes httpPort field with default", () => {
    const httpPortField = configSchema.fields.find((f) => f.name === "httpPort");
    expect(httpPortField).toBeDefined();
    expect(httpPortField?.type).toBe("number");
    expect(httpPortField?.default).toBe(8080);
  });

  it("includes autoStart boolean field", () => {
    const autoStartField = configSchema.fields.find((f) => f.name === "autoStart");
    expect(autoStartField).toBeDefined();
    expect(autoStartField?.type).toBe("boolean");
    expect(autoStartField?.default).toBe(true);
  });

  it("includes dmPolicy field with default", () => {
    const dmPolicyField = configSchema.fields.find((f) => f.name === "dmPolicy");
    expect(dmPolicyField).toBeDefined();
    expect(dmPolicyField?.type).toBe("select");
    expect(dmPolicyField?.default).toBe("pairing");
  });

  it("includes groupPolicy field with default", () => {
    const groupPolicyField = configSchema.fields.find((f) => f.name === "groupPolicy");
    expect(groupPolicyField).toBeDefined();
    expect(groupPolicyField?.type).toBe("select");
    expect(groupPolicyField?.default).toBe("allowlist");
  });

  it("includes mediaMaxMb field with default", () => {
    const mediaField = configSchema.fields.find((f) => f.name === "mediaMaxMb");
    expect(mediaField).toBeDefined();
    expect(mediaField?.type).toBe("number");
    expect(mediaField?.default).toBe(8);
  });

  it("includes sendReadReceipts boolean field", () => {
    const receiptsField = configSchema.fields.find((f) => f.name === "sendReadReceipts");
    expect(receiptsField).toBeDefined();
    expect(receiptsField?.type).toBe("boolean");
    expect(receiptsField?.default).toBe(false);
  });

  it("all fields have name and type", () => {
    for (const field of configSchema.fields) {
      expect(field.name).toBeTruthy();
      expect(field.type).toBeTruthy();
    }
  });
});
