import { describe, expect, it, vi } from "vitest";
import { handleRedditEvent } from "../message-adapter.js";
import type { RedditInboundEvent, WOPRPluginContext } from "../types.js";

function makeEvent(overrides: Partial<RedditInboundEvent> = {}): RedditInboundEvent {
  return {
    type: "post",
    id: "t3_abc123",
    author: "someuser",
    body: "Hello world",
    subreddit: "typescript",
    thingName: "t3_abc123",
    ...overrides,
  };
}

function makeCtx(sessions: string[]): WOPRPluginContext {
  return {
    getSessions: () => sessions,
    inject: vi.fn().mockResolvedValue("ok"),
  } as unknown as WOPRPluginContext;
}

describe("multi-session fan-out", () => {
  it("delivers event to ALL active sessions", async () => {
    const ctx = makeCtx(["session-a", "session-b", "session-c"]);
    const event = makeEvent();

    const sessions = ctx.getSessions() ?? [];
    const targets = sessions.length > 0 ? sessions : ["default"];
    for (const session of targets) {
      await handleRedditEvent(event, ctx, session, "botuser");
    }

    expect(ctx.inject).toHaveBeenCalledTimes(3);
    expect(ctx.inject).toHaveBeenCalledWith("session-a", expect.any(String), expect.any(Object));
    expect(ctx.inject).toHaveBeenCalledWith("session-b", expect.any(String), expect.any(Object));
    expect(ctx.inject).toHaveBeenCalledWith("session-c", expect.any(String), expect.any(Object));
  });

  it("falls back to 'default' when no sessions exist", async () => {
    const ctx = makeCtx([]);
    const event = makeEvent();

    const sessions = ctx.getSessions() ?? [];
    const targets = sessions.length > 0 ? sessions : ["default"];
    for (const session of targets) {
      await handleRedditEvent(event, ctx, session, "botuser");
    }

    expect(ctx.inject).toHaveBeenCalledTimes(1);
    expect(ctx.inject).toHaveBeenCalledWith("default", expect.any(String), expect.any(Object));
  });

  it("delivers to single session when only one exists", async () => {
    const ctx = makeCtx(["only-one"]);
    const event = makeEvent();

    const sessions = ctx.getSessions() ?? [];
    const targets = sessions.length > 0 ? sessions : ["default"];
    for (const session of targets) {
      await handleRedditEvent(event, ctx, session, "botuser");
    }

    expect(ctx.inject).toHaveBeenCalledTimes(1);
    expect(ctx.inject).toHaveBeenCalledWith("only-one", expect.any(String), expect.any(Object));
  });

  it("one session failure does not prevent delivery to others", async () => {
    const ctx = makeCtx(["good-1", "bad", "good-2"]);
    (ctx.inject as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce("ok")
      .mockRejectedValueOnce(new Error("inject failed"))
      .mockResolvedValueOnce("ok");
    const event = makeEvent();

    const sessions = ctx.getSessions() ?? [];
    const targets = sessions.length > 0 ? sessions : ["default"];
    for (const session of targets) {
      await handleRedditEvent(event, ctx, session, "botuser").catch(() => {});
    }

    expect(ctx.inject).toHaveBeenCalledTimes(3);
  });
});
