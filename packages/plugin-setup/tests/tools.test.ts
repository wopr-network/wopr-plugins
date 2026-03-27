import type { A2AToolDefinition, WOPRPluginContext } from "@wopr-network/plugin-types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearAllSessions, createSession, getSession } from "../src/session-store.js";
import { createSetupTools } from "../src/tools.js";

// Mock fetch for installDependency, testConnection, rollback
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function makeCtx(config: Record<string, unknown> = {}): WOPRPluginContext {
  let savedConfig = { ...config };
  return {
    getConfig: () => savedConfig as unknown,
    saveConfig: vi.fn(async (c: Record<string, unknown>) => {
      savedConfig = c;
    }),
    events: { emit: vi.fn() } as unknown as WOPRPluginContext["events"],
  } as unknown as WOPRPluginContext;
}

describe("setup tools", () => {
  let tools: A2AToolDefinition[];
  let ctx: ReturnType<typeof makeCtx>;

  beforeEach(() => {
    clearAllSessions();
    mockFetch.mockReset();
    ctx = makeCtx();
    tools = createSetupTools(ctx as WOPRPluginContext);
  });

  function tool(name: string) {
    return tools.find((t) => t.name === name)!;
  }

  describe("setup.ask", () => {
    it("returns formatted prompt for password field", async () => {
      createSession("s1", "p", { title: "T", fields: [] });
      const result = await tool("setup.ask").handler({
        sessionId: "s1",
        field: {
          name: "token",
          type: "password",
          label: "API Token",
          description: "Your secret key",
        },
      });
      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain("API Token");
      expect(result.content[0].text).toContain("stored securely");
    });

    it("returns formatted prompt with select options", async () => {
      createSession("s2", "p", { title: "T", fields: [] });
      const result = await tool("setup.ask").handler({
        sessionId: "s2",
        field: {
          name: "model",
          type: "select",
          label: "Model",
          options: [
            { value: "gpt-4", label: "GPT-4" },
            { value: "claude", label: "Claude" },
          ],
        },
      });
      expect(result.content[0].text).toContain("gpt-4");
      expect(result.content[0].text).toContain("Claude");
    });

    it("errors on missing session", async () => {
      const result = await tool("setup.ask").handler({
        sessionId: "nope",
        field: { name: "x", type: "text", label: "X" },
      });
      expect(result.isError).toBe(true);
    });
  });

  describe("setup.saveConfig", () => {
    it("saves a valid config value and records mutation", async () => {
      createSession("s1", "p", {
        title: "T",
        fields: [{ name: "token", type: "password", label: "Token", required: true }],
      });
      const result = await tool("setup.saveConfig").handler({
        sessionId: "s1",
        key: "token",
        value: "sk-123",
      });
      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain("Saved");
      expect(ctx.saveConfig).toHaveBeenCalled();
      const session = getSession("s1")!;
      expect(session.mutations).toHaveLength(1);
      expect(session.mutations[0]).toEqual({ type: "saveConfig", key: "token", value: "sk-123" });
    });

    it("rejects unknown field", async () => {
      createSession("s2", "p", {
        title: "T",
        fields: [{ name: "token", type: "text", label: "Token" }],
      });
      const result = await tool("setup.saveConfig").handler({
        sessionId: "s2",
        key: "unknown",
        value: "x",
      });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Unknown config field");
    });

    it("rejects empty required field", async () => {
      createSession("s3", "p", {
        title: "T",
        fields: [{ name: "token", type: "text", label: "Token", required: true }],
      });
      const result = await tool("setup.saveConfig").handler({
        sessionId: "s3",
        key: "token",
        value: "",
      });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("required");
    });

    it("validates pattern if present", async () => {
      createSession("s4", "p", {
        title: "T",
        fields: [
          {
            name: "id",
            type: "text",
            label: "ID",
            pattern: "^\\d+$",
            patternError: "Must be numeric",
          },
        ],
      });
      const result = await tool("setup.saveConfig").handler({
        sessionId: "s4",
        key: "id",
        value: "abc",
      });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Must be numeric");
    });
  });

  describe("setup.installDependency", () => {
    it("calls platform API and records mutation on success", async () => {
      createSession("s1", "p", { title: "T", fields: [] });
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ success: true }) });
      const result = await tool("setup.installDependency").handler({
        sessionId: "s1",
        pluginId: "@wopr-network/wopr-plugin-voice",
      });
      expect(result.isError).toBeFalsy();
      expect(getSession("s1")!.mutations[0]).toEqual({
        type: "installDependency",
        pluginId: "@wopr-network/wopr-plugin-voice",
      });
    });

    it("returns error on API failure", async () => {
      createSession("s2", "p", { title: "T", fields: [] });
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ error: "boom" }),
      });
      const result = await tool("setup.installDependency").handler({
        sessionId: "s2",
        pluginId: "bad-plugin",
      });
      expect(result.isError).toBe(true);
    });
  });

  describe("setup.testConnection", () => {
    it("returns healthy on 200", async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });
      const result = await tool("setup.testConnection").handler({ service: "discord" });
      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain("healthy");
    });

    it("returns error on failure", async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 503, text: async () => "down" });
      const result = await tool("setup.testConnection").handler({ service: "discord" });
      expect(result.isError).toBe(true);
    });
  });

  describe("setup.complete", () => {
    it("marks session complete and emits event", async () => {
      createSession("s1", "my-plugin", { title: "T", fields: [] });
      const result = await tool("setup.complete").handler({ sessionId: "s1" });
      expect(result.isError).toBeFalsy();
      expect(getSession("s1")).toBeUndefined();
      expect(ctx.events.emit).toHaveBeenCalledWith(
        "setup:complete",
        expect.objectContaining({ pluginId: "my-plugin" }),
      );
    });

    it("errors if already completed", async () => {
      createSession("s2", "p", { title: "T", fields: [] });
      getSession("s2")!.completed = true;
      const result = await tool("setup.complete").handler({ sessionId: "s2" });
      expect(result.isError).toBe(true);
    });
  });

  describe("setup.rollback", () => {
    it("reverses saveConfig mutations in LIFO order", async () => {
      createSession("s1", "p", { title: "T", fields: [] });
      const session = getSession("s1")!;
      session.mutations.push({ type: "saveConfig", key: "a", value: "1" });
      session.mutations.push({ type: "saveConfig", key: "b", value: "2" });

      const result = await tool("setup.rollback").handler({ sessionId: "s1" });
      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain("Rollback complete");
      expect(ctx.saveConfig).toHaveBeenCalledTimes(2);
      expect(getSession("s1")).toBeUndefined();
    });

    it("reverses installDependency mutations", async () => {
      createSession("s2", "p", { title: "T", fields: [] });
      const session = getSession("s2")!;
      session.mutations.push({ type: "installDependency", pluginId: "test-plugin" });
      mockFetch.mockResolvedValueOnce({ ok: true });

      const result = await tool("setup.rollback").handler({ sessionId: "s2" });
      expect(result.isError).toBeFalsy();
      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:7437/plugins/uninstall",
        expect.objectContaining({ method: "POST" }),
      );
    });

    it("reports errors but continues rolling back", async () => {
      createSession("s3", "p", { title: "T", fields: [] });
      const session = getSession("s3")!;
      session.mutations.push({ type: "installDependency", pluginId: "p1" });
      session.mutations.push({ type: "saveConfig", key: "a", value: "1" });
      mockFetch.mockResolvedValueOnce({ ok: false, status: 500 }); // uninstall fails

      const result = await tool("setup.rollback").handler({ sessionId: "s3" });
      expect(ctx.saveConfig).toHaveBeenCalled();
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("errors");
    });
  });
});
