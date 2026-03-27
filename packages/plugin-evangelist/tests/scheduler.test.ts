import { describe, it, expect, beforeEach } from "vitest";
import { ContentScheduler } from "../src/scheduler.js";

describe("scheduler", () => {
  let scheduler: ContentScheduler;

  beforeEach(() => {
    scheduler = new ContentScheduler();
  });

  it("schedules a post and returns it with status pending", () => {
    const post = scheduler.schedule("twitter", "Hello world", new Date("2026-04-01T12:00:00Z"));
    expect(post.platform).toBe("twitter");
    expect(post.content).toBe("Hello world");
    expect(post.status).toBe("pending");
    expect(post.id).toBeTruthy();
  });

  it("getDuePosts returns posts whose scheduledAt has passed", () => {
    scheduler.schedule("twitter", "Past post", new Date("2020-01-01T00:00:00Z"));
    scheduler.schedule("reddit", "Future post", new Date("2099-01-01T00:00:00Z"));
    const due = scheduler.getDuePosts();
    expect(due).toHaveLength(1);
    expect(due[0].platform).toBe("twitter");
  });

  it("markPosted changes status to posted", () => {
    const post = scheduler.schedule("twitter", "Test", new Date("2020-01-01T00:00:00Z"));
    scheduler.markPosted(post.id);
    const due = scheduler.getDuePosts();
    expect(due).toHaveLength(0);
  });

  it("markFailed changes status to failed", () => {
    const post = scheduler.schedule("discord", "Test", new Date("2020-01-01T00:00:00Z"));
    scheduler.markFailed(post.id);
    const all = scheduler.getAll();
    expect(all.find((p) => p.id === post.id)?.status).toBe("failed");
  });

  it("getAll returns all scheduled posts", () => {
    scheduler.schedule("twitter", "A", new Date("2026-04-01T12:00:00Z"));
    scheduler.schedule("reddit", "B", new Date("2026-04-02T12:00:00Z"));
    expect(scheduler.getAll()).toHaveLength(2);
  });
});
