import { describe, it, expect, beforeEach } from "vitest";
import {
  updateEditorContext,
  getEditorContext,
  clearEditorContext,
  formatEditorContext,
} from "../src/context.js";
import type { AcpChatMessageParams } from "../src/types.js";

describe("context", () => {
  beforeEach(() => {
    clearEditorContext("test-session");
  });

  describe("updateEditorContext / getEditorContext", () => {
    it("stores and retrieves editor context for a session", () => {
      updateEditorContext("test-session", {
        sessionId: "test-session",
        context: {
          cursorPosition: { path: "src/main.ts", line: 10, column: 5 },
        },
      });
      const ctx = getEditorContext("test-session");
      expect(ctx).toBeDefined();
      expect(ctx!.cursorPosition).toEqual({
        path: "src/main.ts",
        line: 10,
        column: 5,
      });
    });

    it("returns undefined for unknown session", () => {
      expect(getEditorContext("unknown")).toBeUndefined();
    });

    it("merges new fields without overwriting existing ones", () => {
      updateEditorContext("test-session", {
        sessionId: "test-session",
        context: {
          cursorPosition: { path: "a.ts", line: 1, column: 1 },
        },
      });
      updateEditorContext("test-session", {
        sessionId: "test-session",
        context: {
          selection: {
            path: "a.ts",
            startLine: 1,
            endLine: 5,
            text: "selected",
          },
        },
      });
      const ctx = getEditorContext("test-session");
      expect(ctx!.cursorPosition).toEqual({
        path: "a.ts",
        line: 1,
        column: 1,
      });
      expect(ctx!.selection).toEqual({
        path: "a.ts",
        startLine: 1,
        endLine: 5,
        text: "selected",
      });
    });

    it("overwrites existing fields when new value is provided", () => {
      updateEditorContext("test-session", {
        sessionId: "test-session",
        context: {
          cursorPosition: { path: "a.ts", line: 1, column: 1 },
        },
      });
      updateEditorContext("test-session", {
        sessionId: "test-session",
        context: {
          cursorPosition: { path: "b.ts", line: 99, column: 10 },
        },
      });
      const ctx = getEditorContext("test-session");
      expect(ctx!.cursorPosition).toEqual({
        path: "b.ts",
        line: 99,
        column: 10,
      });
    });

    it("stores files array", () => {
      updateEditorContext("test-session", {
        sessionId: "test-session",
        context: {
          files: [
            { path: "a.ts", content: "const a = 1;", language: "typescript" },
            { path: "b.ts" },
          ],
        },
      });
      const ctx = getEditorContext("test-session");
      expect(ctx!.files).toHaveLength(2);
      expect(ctx!.files![0].content).toBe("const a = 1;");
      expect(ctx!.files![1].content).toBeUndefined();
    });

    it("stores diagnostics array", () => {
      updateEditorContext("test-session", {
        sessionId: "test-session",
        context: {
          diagnostics: [
            {
              path: "a.ts",
              line: 5,
              severity: "error",
              message: "Type error",
            },
          ],
        },
      });
      const ctx = getEditorContext("test-session");
      expect(ctx!.diagnostics).toHaveLength(1);
      expect(ctx!.diagnostics![0].severity).toBe("error");
    });
  });

  describe("clearEditorContext", () => {
    it("removes stored context for a session", () => {
      updateEditorContext("test-session", {
        sessionId: "test-session",
        context: {
          cursorPosition: { path: "a.ts", line: 1, column: 1 },
        },
      });
      clearEditorContext("test-session");
      expect(getEditorContext("test-session")).toBeUndefined();
    });

    it("does nothing for non-existent session", () => {
      clearEditorContext("nonexistent");
      // no error thrown
    });
  });

  describe("formatEditorContext", () => {
    it("returns empty string when no context is available", () => {
      const params: AcpChatMessageParams = { message: "hello" };
      expect(formatEditorContext(params)).toBe("");
    });

    it("formats cursor position", () => {
      const params: AcpChatMessageParams = {
        message: "hello",
        context: {
          cursorPosition: { path: "main.ts", line: 42, column: 8 },
        },
      };
      const result = formatEditorContext(params);
      expect(result).toBe("Cursor: main.ts:42:8");
    });

    it("formats selection with code block", () => {
      const params: AcpChatMessageParams = {
        message: "hello",
        context: {
          selection: {
            path: "main.ts",
            startLine: 10,
            endLine: 15,
            text: "function foo() {}",
          },
        },
      };
      const result = formatEditorContext(params);
      expect(result).toContain(
        "Selected text in main.ts (lines 10-15):"
      );
      expect(result).toContain("```");
      expect(result).toContain("function foo() {}");
    });

    it("formats open files with content and language", () => {
      const params: AcpChatMessageParams = {
        message: "hello",
        context: {
          files: [
            {
              path: "src/app.ts",
              content: "const x = 1;",
              language: "typescript",
            },
          ],
        },
      };
      const result = formatEditorContext(params);
      expect(result).toContain("File: src/app.ts");
      expect(result).toContain("```typescript");
      expect(result).toContain("const x = 1;");
    });

    it("formats open files without content as path only", () => {
      const params: AcpChatMessageParams = {
        message: "hello",
        context: {
          files: [{ path: "src/app.ts" }],
        },
      };
      const result = formatEditorContext(params);
      expect(result).toBe("Open file: src/app.ts");
    });

    it("formats files without language tag", () => {
      const params: AcpChatMessageParams = {
        message: "hello",
        context: {
          files: [{ path: "readme.md", content: "# Hello" }],
        },
      };
      const result = formatEditorContext(params);
      expect(result).toContain("```\n# Hello");
    });

    it("formats diagnostics", () => {
      const params: AcpChatMessageParams = {
        message: "hello",
        context: {
          diagnostics: [
            {
              path: "a.ts",
              line: 5,
              severity: "error",
              message: "Type error",
            },
            {
              path: "b.ts",
              line: 12,
              severity: "warning",
              message: "Unused var",
            },
          ],
        },
      };
      const result = formatEditorContext(params);
      expect(result).toContain("Diagnostics:");
      expect(result).toContain("[error] a.ts:5 - Type error");
      expect(result).toContain("[warning] b.ts:12 - Unused var");
    });

    it("combines all context sections", () => {
      const params: AcpChatMessageParams = {
        message: "hello",
        context: {
          cursorPosition: { path: "a.ts", line: 1, column: 1 },
          selection: {
            path: "a.ts",
            startLine: 1,
            endLine: 3,
            text: "abc",
          },
          files: [{ path: "a.ts", content: "full file" }],
          diagnostics: [
            { path: "a.ts", line: 1, severity: "info", message: "hint" },
          ],
        },
      };
      const result = formatEditorContext(params);
      expect(result).toContain("Cursor:");
      expect(result).toContain("Selected text");
      expect(result).toContain("File:");
      expect(result).toContain("Diagnostics:");
    });

    it("uses stored session context when no inline context", () => {
      updateEditorContext("s1", {
        sessionId: "s1",
        context: {
          cursorPosition: { path: "stored.ts", line: 7, column: 3 },
        },
      });
      const params: AcpChatMessageParams = { message: "hello" };
      const result = formatEditorContext(params, "s1");
      expect(result).toBe("Cursor: stored.ts:7:3");
      clearEditorContext("s1");
    });

    it("inline context takes priority over stored context", () => {
      updateEditorContext("s2", {
        sessionId: "s2",
        context: {
          cursorPosition: { path: "stored.ts", line: 1, column: 1 },
        },
      });
      const params: AcpChatMessageParams = {
        message: "hello",
        context: {
          cursorPosition: { path: "inline.ts", line: 99, column: 1 },
        },
      };
      const result = formatEditorContext(params, "s2");
      expect(result).toBe("Cursor: inline.ts:99:1");
      clearEditorContext("s2");
    });
  });
});
