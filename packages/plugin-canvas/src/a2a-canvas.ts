/**
 * Canvas A2A tools (WOP-113)
 *
 * Provides agents with tools to push visual content to the WebUI canvas:
 *   canvas_push     — push HTML/Markdown/chart/form content
 *   canvas_remove   — remove a single item by id
 *   canvas_reset    — clear all canvas items for the session
 *   canvas_snapshot — take a snapshot of the current canvas state
 *   canvas_get      — get current canvas items (no side-effects)
 */

import type { A2AServerConfig } from "@wopr-network/plugin-types";
import { canvasGet, canvasPush, canvasRemove, canvasReset, canvasSnapshot } from "./canvas.js";

export function createCanvasA2AServer(sessionName: string): A2AServerConfig {
  return {
    name: "canvas",
    version: "1.0.0",
    tools: [
      {
        name: "canvas_push",
        description:
          "Push visual content (HTML, Markdown, chart, or form) to the WebUI canvas for the current session.",
        inputSchema: {
          type: "object",
          properties: {
            type: {
              type: "string",
              enum: ["html", "markdown", "chart", "form"],
              description: "Content type to render",
            },
            content: {
              type: "string",
              description: "The content body (HTML string, Markdown text, chart JSON, or form schema)",
            },
            title: {
              type: "string",
              description: "Optional display title for the canvas item",
            },
            id: {
              type: "string",
              description: "Optional custom id (auto-generated if omitted)",
            },
          },
          required: ["type", "content"],
        },
        async handler(args) {
          const { type, content, title, id } = args as {
            type: "html" | "markdown" | "chart" | "form";
            content: string;
            title?: string;
            id?: string;
          };
          const item = await canvasPush(sessionName, type, content, { title, id });
          return {
            content: [
              {
                type: "text",
                text: `Canvas item pushed: ${item.id} (${item.type})`,
              },
            ],
          };
        },
      },
      {
        name: "canvas_remove",
        description: "Remove a single item from the canvas by its id.",
        inputSchema: {
          type: "object",
          properties: {
            id: {
              type: "string",
              description: "The id of the canvas item to remove",
            },
          },
          required: ["id"],
        },
        async handler(args) {
          const { id } = args as { id: string };
          const removed = await canvasRemove(sessionName, id);
          return {
            content: [
              {
                type: "text",
                text: removed ? `Canvas item ${id} removed` : `Canvas item ${id} not found`,
              },
            ],
          };
        },
      },
      {
        name: "canvas_reset",
        description: "Clear all items from the canvas for the current session.",
        inputSchema: {
          type: "object",
          properties: {},
        },
        async handler() {
          await canvasReset(sessionName);
          return {
            content: [{ type: "text", text: "Canvas cleared" }],
          };
        },
      },
      {
        name: "canvas_snapshot",
        description: "Take a snapshot of the current canvas state and return all items.",
        inputSchema: {
          type: "object",
          properties: {},
        },
        async handler() {
          const snap = await canvasSnapshot(sessionName);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(snap, null, 2),
              },
            ],
          };
        },
      },
      {
        name: "canvas_get",
        description: "Get current canvas items for the session without emitting events.",
        inputSchema: {
          type: "object",
          properties: {},
        },
        async handler() {
          const items = canvasGet(sessionName);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(items, null, 2),
              },
            ],
          };
        },
      },
    ],
  };
}
