import { vi, describe, it, expect, beforeEach } from "vitest";
import { createCanvasA2AServer } from "../src/a2a-canvas.js";
import { _resetCanvasState, setCanvasPublish, setCanvasEmitCustom } from "../src/canvas.js";

describe("createCanvasA2AServer", () => {
  beforeEach(() => {
    _resetCanvasState();
    setCanvasPublish(vi.fn());
    setCanvasEmitCustom(vi.fn().mockResolvedValue(undefined));
  });

  it("returns an A2A server config with correct name and version", () => {
    const server = createCanvasA2AServer("test-session");
    expect(server.name).toBe("canvas");
    expect(server.version).toBe("1.0.0");
  });

  it("provides 5 canvas tools", () => {
    const server = createCanvasA2AServer("test-session");
    expect(server.tools).toHaveLength(5);
    const names = server.tools.map((t) => t.name);
    expect(names).toContain("canvas_push");
    expect(names).toContain("canvas_remove");
    expect(names).toContain("canvas_reset");
    expect(names).toContain("canvas_snapshot");
    expect(names).toContain("canvas_get");
  });

  describe("canvas_push tool", () => {
    it("pushes content and returns confirmation", async () => {
      const server = createCanvasA2AServer("test-session");
      const pushTool = server.tools.find((t) => t.name === "canvas_push")!;
      const result = await pushTool.handler({
        type: "html",
        content: "<p>Test</p>",
      });
      expect(result.content[0].text).toContain("Canvas item pushed");
      expect(result.content[0].text).toContain("html");
    });
  });

  describe("canvas_remove tool", () => {
    it("removes an existing item", async () => {
      const server = createCanvasA2AServer("test-session");
      const pushTool = server.tools.find((t) => t.name === "canvas_push")!;
      const removeTool = server.tools.find((t) => t.name === "canvas_remove")!;

      await pushTool.handler({ type: "html", content: "x", id: "rm-1" });
      const result = await removeTool.handler({ id: "rm-1" });
      expect(result.content[0].text).toContain("removed");
    });

    it("reports not found for missing item", async () => {
      const server = createCanvasA2AServer("test-session");
      const removeTool = server.tools.find((t) => t.name === "canvas_remove")!;
      const result = await removeTool.handler({ id: "nope" });
      expect(result.content[0].text).toContain("not found");
    });
  });

  describe("canvas_reset tool", () => {
    it("clears the canvas", async () => {
      const server = createCanvasA2AServer("test-session");
      const pushTool = server.tools.find((t) => t.name === "canvas_push")!;
      const resetTool = server.tools.find((t) => t.name === "canvas_reset")!;
      const getTool = server.tools.find((t) => t.name === "canvas_get")!;

      await pushTool.handler({ type: "html", content: "a" });
      await resetTool.handler({});
      const result = await getTool.handler({});
      expect(JSON.parse(result.content[0].text)).toEqual([]);
    });
  });

  describe("canvas_snapshot tool", () => {
    it("returns a JSON snapshot", async () => {
      const server = createCanvasA2AServer("test-session");
      const pushTool = server.tools.find((t) => t.name === "canvas_push")!;
      const snapTool = server.tools.find((t) => t.name === "canvas_snapshot")!;

      await pushTool.handler({ type: "markdown", content: "# Hi" });
      const result = await snapTool.handler({});
      const snap = JSON.parse(result.content[0].text);
      expect(snap.session).toBe("test-session");
      expect(snap.items).toHaveLength(1);
    });
  });

  describe("canvas_get tool", () => {
    it("returns current items as JSON", async () => {
      const server = createCanvasA2AServer("test-session");
      const pushTool = server.tools.find((t) => t.name === "canvas_push")!;
      const getTool = server.tools.find((t) => t.name === "canvas_get")!;

      await pushTool.handler({ type: "form", content: "{}" });
      const result = await getTool.handler({});
      const items = JSON.parse(result.content[0].text);
      expect(items).toHaveLength(1);
      expect(items[0].type).toBe("form");
    });
  });
});
