/**
 * Config validation tests for wopr-plugin-imessage.
 *
 * Validates that the IMessageConfig interface and config schema are correct.
 */
import { describe, expect, it, vi } from "vitest";
import type { IMessageConfig } from "../src/types.js";

// Mock logger and child_process to safely import plugin
vi.mock("../src/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    verbose: vi.fn(),
  },
}));

vi.mock("node:child_process", () => ({
  spawn: vi.fn(() => {
    const EventEmitter = require("node:events");
    const child = new EventEmitter();
    child.stdin = { write: vi.fn(), end: vi.fn() };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.killed = false;
    child.kill = vi.fn();
    setTimeout(() => child.emit("close", 1, null), 10);
    return child;
  }),
}));

import plugin from "../src/index.js";
import { createMockContext } from "./mocks/wopr-context.js";

describe("config validation", () => {
  it("IMessageConfig accepts valid full config", () => {
    const config: IMessageConfig = {
      enabled: true,
      cliPath: "/usr/local/bin/imsg",
      dbPath: "/Users/test/Library/Messages/chat.db",
      service: "auto",
      region: "US",
      dmPolicy: "pairing",
      allowFrom: ["+1234567890", "user@icloud.com"],
      groupPolicy: "allowlist",
      groupAllowFrom: ["+1234567890"],
      includeAttachments: false,
      mediaMaxMb: 16,
      textChunkLimit: 4000,
    };

    expect(config.enabled).toBe(true);
    expect(config.service).toBe("auto");
    expect(config.dmPolicy).toBe("pairing");
    expect(config.groupPolicy).toBe("allowlist");
  });

  it("IMessageConfig accepts empty config (all optional)", () => {
    const config: IMessageConfig = {};
    expect(config).toBeDefined();
    expect(config.enabled).toBeUndefined();
    expect(config.cliPath).toBeUndefined();
  });

  it("IMessageConfig service accepts valid enum values", () => {
    const configs: IMessageConfig[] = [{ service: "imessage" }, { service: "sms" }, { service: "auto" }];
    expect(configs).toHaveLength(3);
    expect(configs[0].service).toBe("imessage");
    expect(configs[1].service).toBe("sms");
    expect(configs[2].service).toBe("auto");
  });

  it("IMessageConfig dmPolicy accepts valid enum values", () => {
    const policies: IMessageConfig["dmPolicy"][] = ["pairing", "open", "closed", "allowlist"];
    for (const policy of policies) {
      const config: IMessageConfig = { dmPolicy: policy };
      expect(config.dmPolicy).toBe(policy);
    }
  });

  it("IMessageConfig groupPolicy accepts valid enum values", () => {
    const policies: IMessageConfig["groupPolicy"][] = ["allowlist", "open", "disabled"];
    for (const policy of policies) {
      const config: IMessageConfig = { groupPolicy: policy };
      expect(config.groupPolicy).toBe(policy);
    }
  });

  describe("config schema structure", () => {
    it("schema has title and description", async () => {
      const ctx = createMockContext();
      try {
        await plugin.init?.(ctx);
      } catch {
        // Expected
      }

      const call = (ctx.registerConfigSchema as any).mock.calls[0];
      const schema = call[1];

      expect(schema.title).toBeTruthy();
      expect(schema.description).toBeTruthy();
      expect(schema.fields).toBeInstanceOf(Array);
      expect(schema.fields.length).toBeGreaterThan(0);
    });

    it("all fields have required properties", async () => {
      const ctx = createMockContext();
      try {
        await plugin.init?.(ctx);
      } catch {
        // Expected
      }

      const call = (ctx.registerConfigSchema as any).mock.calls[0];
      const schema = call[1];

      for (const field of schema.fields) {
        expect(field.name).toBeTruthy();
        expect(field.type).toBeTruthy();
        expect(field.label).toBeTruthy();
      }
    });

    it("select fields have options", async () => {
      const ctx = createMockContext();
      try {
        await plugin.init?.(ctx);
      } catch {
        // Expected
      }

      const call = (ctx.registerConfigSchema as any).mock.calls[0];
      const schema = call[1];

      const selectFields = schema.fields.filter((f: any) => f.type === "select");
      expect(selectFields.length).toBeGreaterThan(0);

      for (const field of selectFields) {
        expect(field.options).toBeInstanceOf(Array);
        expect(field.options.length).toBeGreaterThan(0);
        for (const opt of field.options) {
          expect(opt.value).toBeTruthy();
          expect(opt.label).toBeTruthy();
        }
      }
    });

    it("enabled field defaults to true", async () => {
      const ctx = createMockContext();
      try {
        await plugin.init?.(ctx);
      } catch {
        // Expected
      }

      const call = (ctx.registerConfigSchema as any).mock.calls[0];
      const schema = call[1];
      const enabledField = schema.fields.find((f: any) => f.name === "enabled");

      expect(enabledField).toBeDefined();
      expect(enabledField.type).toBe("checkbox");
      expect(enabledField.default).toBe(true);
    });

    it("dmPolicy field defaults to pairing", async () => {
      const ctx = createMockContext();
      try {
        await plugin.init?.(ctx);
      } catch {
        // Expected
      }

      const call = (ctx.registerConfigSchema as any).mock.calls[0];
      const schema = call[1];
      const dmPolicyField = schema.fields.find((f: any) => f.name === "dmPolicy");

      expect(dmPolicyField).toBeDefined();
      expect(dmPolicyField.default).toBe("pairing");
    });
  });
});
