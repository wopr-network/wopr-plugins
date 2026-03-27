import { beforeEach, describe, expect, it } from "vitest";
import {
  clearAllSessions,
  createSession,
  deleteSession,
  getSession,
  isSetupActive,
} from "../src/session-store.js";

describe("session-store", () => {
  beforeEach(() => {
    clearAllSessions();
  });

  it("creates and retrieves a session", () => {
    const schema = {
      title: "Test",
      fields: [{ name: "token", type: "password" as const, label: "Token" }],
    };
    const session = createSession("sess-1", "my-plugin", schema);
    expect(session.sessionId).toBe("sess-1");
    expect(session.pluginId).toBe("my-plugin");
    expect(session.mutations).toEqual([]);
    expect(session.completed).toBe(false);

    const retrieved = getSession("sess-1");
    expect(retrieved).toBe(session);
  });

  it("returns undefined for unknown session", () => {
    expect(getSession("nonexistent")).toBeUndefined();
  });

  it("deletes a session", () => {
    const schema = { title: "Test", fields: [] };
    createSession("sess-2", "p", schema);
    expect(deleteSession("sess-2")).toBe(true);
    expect(getSession("sess-2")).toBeUndefined();
  });

  it("isSetupActive returns true for active, false for completed or missing", () => {
    const schema = { title: "Test", fields: [] };
    createSession("sess-3", "p", schema);
    expect(isSetupActive("sess-3")).toBe(true);

    const s = getSession("sess-3")!;
    s.completed = true;
    expect(isSetupActive("sess-3")).toBe(false);

    expect(isSetupActive("nonexistent")).toBe(false);
  });

  it("clearAllSessions removes everything", () => {
    const schema = { title: "Test", fields: [] };
    createSession("a", "p", schema);
    createSession("b", "p", schema);
    clearAllSessions();
    expect(getSession("a")).toBeUndefined();
    expect(getSession("b")).toBeUndefined();
  });
});
