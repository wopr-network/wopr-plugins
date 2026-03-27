import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleRedditEvent } from "../src/message-adapter.js";
import { createMockContext } from "../src/__test-utils__/mocks.js";
import type { RedditInboundEvent, WOPRPluginContext } from "../src/types.js";

describe("handleRedditEvent", () => {
  let ctx: WOPRPluginContext;

  beforeEach(() => {
    ctx = createMockContext();
  });

  it("injects a comment into the matching session", async () => {
    const event: RedditInboundEvent = {
      type: "comment",
      id: "abc123",
      author: "redditUser",
      body: "Hello WOPR",
      subreddit: "test",
      thingName: "t1_abc123",
    };

    await handleRedditEvent(event, ctx, "default");

    expect(ctx.inject).toHaveBeenCalledWith(
      "default",
      "Hello WOPR",
      expect.objectContaining({
        from: "redditUser",
        channel: { id: "reddit:test", type: "reddit", name: "r/test" },
      }),
    );
  });

  it("injects a DM with the DM channel ref", async () => {
    const event: RedditInboundEvent = {
      type: "dm",
      id: "msg456",
      author: "sender",
      body: "Private message",
      thingName: "t4_msg456",
    };

    await handleRedditEvent(event, ctx, "default");

    expect(ctx.inject).toHaveBeenCalledWith(
      "default",
      "Private message",
      expect.objectContaining({
        from: "sender",
        channel: { id: "reddit:dm:sender", type: "reddit", name: "DM from sender" },
      }),
    );
  });

  it("skips events from the bot's own username", async () => {
    const event: RedditInboundEvent = {
      type: "comment",
      id: "self1",
      author: "wopr_bot",
      body: "My own comment",
      subreddit: "test",
      thingName: "t1_self1",
    };

    await handleRedditEvent(event, ctx, "default", "wopr_bot");
    expect(ctx.inject).not.toHaveBeenCalled();
  });
});
