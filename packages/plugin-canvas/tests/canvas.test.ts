import { vi, describe, it, expect, beforeEach } from "vitest";
import {
  canvasPush,
  canvasRemove,
  canvasReset,
  canvasSnapshot,
  canvasGet,
  setCanvasPublish,
  setCanvasEmitCustom,
  clearCanvasInjections,
  _resetCanvasState,
} from "../src/canvas.js";

describe("canvas operations", () => {
  let mockPublish: ReturnType<typeof vi.fn>;
  let mockEmit: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    _resetCanvasState();
    mockPublish = vi.fn();
    mockEmit = vi.fn().mockResolvedValue(undefined);
    setCanvasPublish(mockPublish);
    setCanvasEmitCustom(mockEmit);
  });

  describe("canvasPush", () => {
    it("pushes an item and returns it", async () => {
      const item = await canvasPush("s1", "html", "<p>Hello</p>");
      expect(item.type).toBe("html");
      expect(item.content).toBe("<p>Hello</p>");
      expect(item.id).toMatch(/^cv_/);
      expect(item.pushedAt).toBeGreaterThan(0);
    });

    it("supports optional title and meta", async () => {
      const item = await canvasPush("s1", "markdown", "# Title", {
        title: "My Title",
        meta: { key: "value" },
      });
      expect(item.title).toBe("My Title");
      expect(item.meta).toEqual({ key: "value" });
    });

    it("supports custom id", async () => {
      const item = await canvasPush("s1", "chart", "{}", { id: "custom-1" });
      expect(item.id).toBe("custom-1");
    });

    it("upserts when custom id already exists", async () => {
      await canvasPush("s1", "html", "v1", { id: "upd" });
      await canvasPush("s1", "html", "v2", { id: "upd" });
      const items = canvasGet("s1");
      expect(items).toHaveLength(1);
      expect(items[0].content).toBe("v2");
    });

    it("broadcasts via publish and emitCustom", async () => {
      await canvasPush("s1", "html", "content");
      expect(mockPublish).toHaveBeenCalledWith(
        "canvas:s1",
        expect.objectContaining({ type: "canvas:push" }),
      );
      expect(mockEmit).toHaveBeenCalledWith(
        "canvas:push",
        expect.objectContaining({ operation: "push" }),
      );
    });
  });

  describe("canvasRemove", () => {
    it("removes an existing item", async () => {
      const item = await canvasPush("s1", "html", "content");
      const removed = await canvasRemove("s1", item.id);
      expect(removed).toBe(true);
      expect(canvasGet("s1")).toHaveLength(0);
    });

    it("returns false for non-existent item", async () => {
      const removed = await canvasRemove("s1", "no-such-id");
      expect(removed).toBe(false);
    });

    it("returns false for non-existent session", async () => {
      const removed = await canvasRemove("no-session", "no-id");
      expect(removed).toBe(false);
    });

    it("broadcasts remove event", async () => {
      const item = await canvasPush("s1", "html", "content");
      await canvasRemove("s1", item.id);
      expect(mockEmit).toHaveBeenCalledWith(
        "canvas:remove",
        expect.objectContaining({ operation: "remove", itemId: item.id }),
      );
    });
  });

  describe("canvasReset", () => {
    it("clears all items for a session", async () => {
      await canvasPush("s1", "html", "a");
      await canvasPush("s1", "html", "b");
      await canvasReset("s1");
      expect(canvasGet("s1")).toHaveLength(0);
    });

    it("does not affect other sessions", async () => {
      await canvasPush("s1", "html", "a");
      await canvasPush("s2", "html", "b");
      await canvasReset("s1");
      expect(canvasGet("s2")).toHaveLength(1);
    });

    it("broadcasts reset event", async () => {
      await canvasReset("s1");
      expect(mockEmit).toHaveBeenCalledWith(
        "canvas:reset",
        expect.objectContaining({ operation: "reset" }),
      );
    });
  });

  describe("canvasSnapshot", () => {
    it("returns current items as a snapshot", async () => {
      await canvasPush("s1", "html", "content");
      const snap = await canvasSnapshot("s1");
      expect(snap.session).toBe("s1");
      expect(snap.items).toHaveLength(1);
      expect(snap.takenAt).toBeGreaterThan(0);
    });

    it("returns empty snapshot for empty session", async () => {
      const snap = await canvasSnapshot("empty");
      expect(snap.items).toHaveLength(0);
    });

    it("returns a copy of items (not a reference)", async () => {
      await canvasPush("s1", "html", "content");
      const snap = await canvasSnapshot("s1");
      snap.items.push({
        id: "fake",
        type: "html",
        content: "injected",
        pushedAt: 0,
      });
      expect(canvasGet("s1")).toHaveLength(1);
    });
  });

  describe("canvasGet", () => {
    it("returns empty array for unknown session", () => {
      expect(canvasGet("unknown")).toEqual([]);
    });

    it("returns a copy of items", async () => {
      await canvasPush("s1", "html", "a");
      const items = canvasGet("s1");
      items.push({ id: "x", type: "html", content: "b", pushedAt: 0 });
      expect(canvasGet("s1")).toHaveLength(1);
    });
  });

  describe("clearCanvasInjections", () => {
    it("clears publish and emitCustom injections", async () => {
      const pub = vi.fn();
      const emit = vi.fn().mockResolvedValue(undefined);
      setCanvasPublish(pub);
      setCanvasEmitCustom(emit);

      // Push triggers both
      await canvasPush("s1", "html", "before");
      expect(pub).toHaveBeenCalledTimes(1);
      expect(emit).toHaveBeenCalledTimes(1);

      // Clear injections
      clearCanvasInjections();

      // Push after clear — neither should fire
      await canvasPush("s1", "html", "after");
      expect(pub).toHaveBeenCalledTimes(1); // still 1
      expect(emit).toHaveBeenCalledTimes(1); // still 1
    });
  });
});
