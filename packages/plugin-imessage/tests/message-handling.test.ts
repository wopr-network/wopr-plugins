/**
 * Message handling unit tests for wopr-plugin-imessage.
 *
 * Tests the shouldRespond() and buildSessionKey() production code exported
 * from src/index.ts, ensuring routing logic regressions are caught.
 */
import { describe, expect, it, vi } from "vitest";
import type { IMessageConfig, IncomingMessage } from "../src/types.js";

// Mock logger to prevent side effects from shouldRespond's logger.info call
vi.mock("../src/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    verbose: vi.fn(),
  },
}));

// Mock child_process to prevent actual imsg spawning during import
vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
}));

import { buildSessionKey, shouldRespond } from "../src/index.js";

describe("buildSessionKey", () => {
  it("builds DM session key from sender", () => {
    const msg: IncomingMessage = {
      text: "hello",
      sender: "+1234567890",
    };
    expect(buildSessionKey(msg)).toBe("imessage-dm-+1234567890");
  });

  it("builds DM session key from handle when no sender", () => {
    const msg: IncomingMessage = {
      text: "hello",
      sender: "",
      handle: "user@icloud.com",
    };
    expect(buildSessionKey(msg)).toBe("imessage-dm-user@icloud.com");
  });

  it("builds DM session key as unknown when neither sender nor handle", () => {
    const msg: IncomingMessage = {
      text: "hello",
      sender: "",
    };
    expect(buildSessionKey(msg)).toBe("imessage-dm-unknown");
  });

  it("builds group session key from chat_id", () => {
    const msg: IncomingMessage = {
      text: "hello",
      sender: "+1234567890",
      is_group: true,
      chat_id: 42,
    };
    expect(buildSessionKey(msg)).toBe("imessage-group-42");
  });

  it("builds group session key from chat_guid", () => {
    const msg: IncomingMessage = {
      text: "hello",
      sender: "+1234567890",
      is_group: true,
      chat_guid: "iMessage;+;chat123",
    };
    expect(buildSessionKey(msg)).toBe("imessage-group-iMessage;+;chat123");
  });

  it("builds group session key from chat_identifier", () => {
    const msg: IncomingMessage = {
      text: "hello",
      sender: "+1234567890",
      is_group: true,
      chat_identifier: "chat://group1",
    };
    expect(buildSessionKey(msg)).toBe("imessage-group-chat://group1");
  });

  it("builds group session key as unknown when no chat identifiers", () => {
    const msg: IncomingMessage = {
      text: "hello",
      sender: "+1234567890",
      is_group: true,
    };
    expect(buildSessionKey(msg)).toBe("imessage-group-unknown");
  });
});

describe("shouldRespond", () => {
  describe("DM policies", () => {
    it("rejects empty text", () => {
      const msg: IncomingMessage = { text: "", sender: "+1234567890" };
      expect(shouldRespond(msg, {})).toBe(false);
    });

    it("rejects whitespace-only text", () => {
      const msg: IncomingMessage = { text: "   ", sender: "+1234567890" };
      expect(shouldRespond(msg, {})).toBe(false);
    });

    it("defaults to pairing for unknown DM senders", () => {
      const msg: IncomingMessage = { text: "hello", sender: "+1234567890" };
      expect(shouldRespond(msg, {})).toBe("pairing");
    });

    it("returns pairing when dmPolicy is pairing", () => {
      const msg: IncomingMessage = { text: "hello", sender: "+1234567890" };
      expect(shouldRespond(msg, { dmPolicy: "pairing" })).toBe("pairing");
    });

    it("accepts all DMs when dmPolicy is open", () => {
      const msg: IncomingMessage = { text: "hello", sender: "+1234567890" };
      expect(shouldRespond(msg, { dmPolicy: "open" })).toBe(true);
    });

    it("rejects all DMs when dmPolicy is closed", () => {
      const msg: IncomingMessage = { text: "hello", sender: "+1234567890" };
      expect(shouldRespond(msg, { dmPolicy: "closed" })).toBe(false);
    });

    it("accepts DMs from allowlisted sender", () => {
      const msg: IncomingMessage = { text: "hello", sender: "+1234567890" };
      const config: IMessageConfig = {
        dmPolicy: "allowlist",
        allowFrom: ["+1234567890"],
      };
      expect(shouldRespond(msg, config)).toBe(true);
    });

    it("rejects DMs from non-allowlisted sender in allowlist mode", () => {
      const msg: IncomingMessage = { text: "hello", sender: "+1234567890" };
      const config: IMessageConfig = {
        dmPolicy: "allowlist",
        allowFrom: ["+0000000000"],
      };
      expect(shouldRespond(msg, config)).toBe(false);
    });

    it("accepts DMs when wildcard in allowlist", () => {
      const msg: IncomingMessage = { text: "hello", sender: "+1234567890" };
      const config: IMessageConfig = {
        dmPolicy: "allowlist",
        allowFrom: ["*"],
      };
      expect(shouldRespond(msg, config)).toBe(true);
    });

    it("matches partial sender in allowlist", () => {
      const msg: IncomingMessage = { text: "hello", sender: "+1234567890" };
      const config: IMessageConfig = {
        dmPolicy: "allowlist",
        allowFrom: ["1234567890"],
      };
      expect(shouldRespond(msg, config)).toBe(true);
    });

    it("uses handle as fallback sender", () => {
      const msg: IncomingMessage = {
        text: "hello",
        sender: "",
        handle: "user@icloud.com",
      };
      const config: IMessageConfig = {
        dmPolicy: "allowlist",
        allowFrom: ["user@icloud.com"],
      };
      expect(shouldRespond(msg, config)).toBe(true);
    });
  });

  describe("group policies", () => {
    const groupMsg: IncomingMessage = {
      text: "hello",
      sender: "+1234567890",
      is_group: true,
      chat_id: 1,
    };

    it("defaults to allowlist for groups (rejects unknown)", () => {
      expect(shouldRespond(groupMsg, {})).toBe(false);
    });

    it("accepts all groups when groupPolicy is open", () => {
      expect(shouldRespond(groupMsg, { groupPolicy: "open" })).toBe(true);
    });

    it("rejects all groups when groupPolicy is disabled", () => {
      expect(shouldRespond(groupMsg, { groupPolicy: "disabled" })).toBe(false);
    });

    it("accepts groups from allowlisted sender", () => {
      const config: IMessageConfig = {
        groupPolicy: "allowlist",
        groupAllowFrom: ["+1234567890"],
      };
      expect(shouldRespond(groupMsg, config)).toBe(true);
    });

    it("rejects groups from non-allowlisted sender", () => {
      const config: IMessageConfig = {
        groupPolicy: "allowlist",
        groupAllowFrom: ["+0000000000"],
      };
      expect(shouldRespond(groupMsg, config)).toBe(false);
    });

    it("accepts groups when wildcard in group allowlist", () => {
      const config: IMessageConfig = {
        groupPolicy: "allowlist",
        groupAllowFrom: ["*"],
      };
      expect(shouldRespond(groupMsg, config)).toBe(true);
    });
  });
});
