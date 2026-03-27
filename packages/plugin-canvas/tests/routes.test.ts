import { beforeEach, describe, expect, it, vi } from "vitest";
import { _resetCanvasState, setCanvasEmitCustom, setCanvasPublish } from "../src/canvas.js";
import { canvasRouter } from "../src/routes.js";

describe("canvas REST routes", () => {
  beforeEach(() => {
    _resetCanvasState();
    setCanvasPublish(vi.fn());
    setCanvasEmitCustom(vi.fn().mockResolvedValue(undefined));
  });

  it("GET /:session returns empty items for new session", async () => {
    const res = await canvasRouter.request("/test-session");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.session).toBe("test-session");
    expect(body.items).toEqual([]);
  });

  it("POST /:session/push creates an item", async () => {
    const res = await canvasRouter.request("/s1/push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "html", content: "<p>Hi</p>" }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.pushed).toBe(true);
    expect(body.item.type).toBe("html");
    expect(body.item.content).toBe("<p>Hi</p>");
  });

  it("POST /:session/push rejects invalid type", async () => {
    const res = await canvasRouter.request("/s1/push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "invalid", content: "x" }),
    });
    expect(res.status).toBe(400);
  });

  it("POST /:session/push rejects missing content", async () => {
    const res = await canvasRouter.request("/s1/push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "html" }),
    });
    expect(res.status).toBe(400);
  });

  it("DELETE /:session/:itemId removes an item", async () => {
    const pushRes = await canvasRouter.request("/s1/push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "html", content: "x", id: "del-1" }),
    });
    expect(pushRes.status).toBe(201);

    const delRes = await canvasRouter.request("/s1/del-1", { method: "DELETE" });
    expect(delRes.status).toBe(200);
    const body = await delRes.json();
    expect(body.removed).toBe(true);
  });

  it("DELETE /:session/:itemId returns 404 for missing item", async () => {
    const res = await canvasRouter.request("/s1/nope", { method: "DELETE" });
    expect(res.status).toBe(404);
  });

  it("POST /:session/reset clears the canvas", async () => {
    await canvasRouter.request("/s1/push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "html", content: "a" }),
    });
    const resetRes = await canvasRouter.request("/s1/reset", { method: "POST" });
    expect(resetRes.status).toBe(200);

    const getRes = await canvasRouter.request("/s1");
    const body = await getRes.json();
    expect(body.items).toEqual([]);
  });

  it("GET /:session/snapshot returns snapshot", async () => {
    await canvasRouter.request("/s1/push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "markdown", content: "# Hi" }),
    });
    const res = await canvasRouter.request("/s1/snapshot");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.session).toBe("s1");
    expect(body.items).toHaveLength(1);
    expect(body.takenAt).toBeGreaterThan(0);
  });

  it("rejects session names with dot-dot segments", async () => {
    const res = await canvasRouter.request("/..%2Fetc%2Fpasswd");
    expect(res.status).toBe(400);
  });

  it("rejects session names with special characters", async () => {
    const res = await canvasRouter.request("/foo%20bar");
    expect(res.status).toBe(400);
  });
});
