import { describe, it, expect } from "vitest";
import {
  AcpInitializeRequestSchema,
  AcpChatMessageRequestSchema,
  AcpChatCancelRequestSchema,
  AcpContextUpdateRequestSchema,
  AcpRequestSchema,
  AcpInitializeResultSchema,
  AcpChatResponseSchema,
  AcpStreamChunkSchema,
  AcpStreamEndSchema,
  createResponse,
  createError,
  RPC_PARSE_ERROR,
  RPC_INVALID_REQUEST,
  RPC_METHOD_NOT_FOUND,
  RPC_INVALID_PARAMS,
  RPC_INTERNAL_ERROR,
  ACP_PROTOCOL_VERSION,
} from "../src/types.js";

describe("types / schemas", () => {
  describe("AcpInitializeRequestSchema", () => {
    it("validates a correct initialize request", () => {
      const msg = {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "0.1.0",
          clientInfo: { name: "Zed", version: "1.0" },
        },
      };
      const result = AcpInitializeRequestSchema.safeParse(msg);
      expect(result.success).toBe(true);
    });

    it("validates with optional capabilities", () => {
      const msg = {
        jsonrpc: "2.0",
        id: "abc",
        method: "initialize",
        params: {
          protocolVersion: "0.1.0",
          clientInfo: { name: "VSCode", version: "2.0" },
          capabilities: { context: true, streaming: false },
        },
      };
      const result = AcpInitializeRequestSchema.safeParse(msg);
      expect(result.success).toBe(true);
    });

    it("rejects missing clientInfo", () => {
      const msg = {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "0.1.0" },
      };
      const result = AcpInitializeRequestSchema.safeParse(msg);
      expect(result.success).toBe(false);
    });

    it("rejects wrong method", () => {
      const msg = {
        jsonrpc: "2.0",
        id: 1,
        method: "init",
        params: {
          protocolVersion: "0.1.0",
          clientInfo: { name: "Zed", version: "1.0" },
        },
      };
      const result = AcpInitializeRequestSchema.safeParse(msg);
      expect(result.success).toBe(false);
    });

    it("rejects wrong jsonrpc version", () => {
      const msg = {
        jsonrpc: "1.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "0.1.0",
          clientInfo: { name: "Zed", version: "1.0" },
        },
      };
      const result = AcpInitializeRequestSchema.safeParse(msg);
      expect(result.success).toBe(false);
    });
  });

  describe("AcpChatMessageRequestSchema", () => {
    it("validates a minimal chat message", () => {
      const msg = {
        jsonrpc: "2.0",
        id: 1,
        method: "chat/message",
        params: { message: "hello" },
      };
      const result = AcpChatMessageRequestSchema.safeParse(msg);
      expect(result.success).toBe(true);
    });

    it("validates with sessionId and full context", () => {
      const msg = {
        jsonrpc: "2.0",
        id: 2,
        method: "chat/message",
        params: {
          sessionId: "s1",
          message: "fix this",
          context: {
            files: [
              { path: "a.ts", content: "const a=1;", language: "typescript" },
            ],
            selection: {
              path: "a.ts",
              startLine: 1,
              endLine: 1,
              text: "const a=1;",
            },
            diagnostics: [
              { path: "a.ts", line: 1, severity: "error", message: "err" },
            ],
            cursorPosition: { path: "a.ts", line: 1, column: 5 },
          },
        },
      };
      const result = AcpChatMessageRequestSchema.safeParse(msg);
      expect(result.success).toBe(true);
    });

    it("rejects missing message field", () => {
      const msg = {
        jsonrpc: "2.0",
        id: 1,
        method: "chat/message",
        params: { sessionId: "s1" },
      };
      const result = AcpChatMessageRequestSchema.safeParse(msg);
      expect(result.success).toBe(false);
    });

    it("rejects invalid severity in diagnostics", () => {
      const msg = {
        jsonrpc: "2.0",
        id: 1,
        method: "chat/message",
        params: {
          message: "test",
          context: {
            diagnostics: [
              { path: "a.ts", line: 1, severity: "fatal", message: "err" },
            ],
          },
        },
      };
      const result = AcpChatMessageRequestSchema.safeParse(msg);
      expect(result.success).toBe(false);
    });
  });

  describe("AcpChatCancelRequestSchema", () => {
    it("validates a cancel request", () => {
      const msg = {
        jsonrpc: "2.0",
        id: 3,
        method: "chat/cancel",
        params: { sessionId: "s1" },
      };
      const result = AcpChatCancelRequestSchema.safeParse(msg);
      expect(result.success).toBe(true);
    });

    it("rejects missing sessionId", () => {
      const msg = {
        jsonrpc: "2.0",
        id: 3,
        method: "chat/cancel",
        params: {},
      };
      const result = AcpChatCancelRequestSchema.safeParse(msg);
      expect(result.success).toBe(false);
    });
  });

  describe("AcpContextUpdateRequestSchema", () => {
    it("validates a context update", () => {
      const msg = {
        jsonrpc: "2.0",
        id: 4,
        method: "context/update",
        params: {
          sessionId: "s1",
          context: {
            cursorPosition: { path: "x.ts", line: 1, column: 1 },
          },
        },
      };
      const result = AcpContextUpdateRequestSchema.safeParse(msg);
      expect(result.success).toBe(true);
    });

    it("rejects missing sessionId", () => {
      const msg = {
        jsonrpc: "2.0",
        id: 4,
        method: "context/update",
        params: {
          context: { cursorPosition: { path: "x.ts", line: 1, column: 1 } },
        },
      };
      const result = AcpContextUpdateRequestSchema.safeParse(msg);
      expect(result.success).toBe(false);
    });
  });

  describe("AcpRequestSchema (union)", () => {
    it("matches initialize", () => {
      const msg = {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "0.1.0",
          clientInfo: { name: "Zed", version: "1.0" },
        },
      };
      const result = AcpRequestSchema.safeParse(msg);
      expect(result.success).toBe(true);
    });

    it("matches chat/message", () => {
      const msg = {
        jsonrpc: "2.0",
        id: 1,
        method: "chat/message",
        params: { message: "hi" },
      };
      const result = AcpRequestSchema.safeParse(msg);
      expect(result.success).toBe(true);
    });
  });

  describe("response schemas", () => {
    it("AcpInitializeResultSchema validates", () => {
      const result = AcpInitializeResultSchema.safeParse({
        protocolVersion: "0.1.0",
        serverInfo: { name: "wopr-acp", version: "1.0.0" },
        capabilities: { context: true, streaming: true },
      });
      expect(result.success).toBe(true);
    });

    it("AcpChatResponseSchema validates", () => {
      const result = AcpChatResponseSchema.safeParse({
        sessionId: "s1",
        content: "response text",
      });
      expect(result.success).toBe(true);
    });

    it("AcpStreamChunkSchema validates", () => {
      const result = AcpStreamChunkSchema.safeParse({
        jsonrpc: "2.0",
        method: "chat/streamChunk",
        params: { sessionId: "s1", delta: "partial" },
      });
      expect(result.success).toBe(true);
    });

    it("AcpStreamEndSchema validates", () => {
      const result = AcpStreamEndSchema.safeParse({
        jsonrpc: "2.0",
        method: "chat/streamEnd",
        params: { sessionId: "s1" },
      });
      expect(result.success).toBe(true);
    });
  });

  describe("createResponse / createError", () => {
    it("creates a valid JSON-RPC response", () => {
      const resp = createResponse(1, { data: "ok" });
      expect(resp).toEqual({
        jsonrpc: "2.0",
        id: 1,
        result: { data: "ok" },
      });
    });

    it("creates a response with string id", () => {
      const resp = createResponse("abc", "value");
      expect(resp.id).toBe("abc");
      expect(resp.result).toBe("value");
    });

    it("creates a response with undefined id", () => {
      const resp = createResponse(undefined, null);
      expect(resp.id).toBeUndefined();
    });

    it("creates a valid JSON-RPC error", () => {
      const err = createError(1, RPC_PARSE_ERROR, "Parse error");
      expect(err).toEqual({
        jsonrpc: "2.0",
        id: 1,
        error: { code: -32700, message: "Parse error" },
      });
    });

    it("creates an error with data", () => {
      const err = createError(2, RPC_INTERNAL_ERROR, "fail", {
        detail: "x",
      });
      expect(err.error!.data).toEqual({ detail: "x" });
    });
  });

  describe("error code constants", () => {
    it("has standard JSON-RPC error codes", () => {
      expect(RPC_PARSE_ERROR).toBe(-32700);
      expect(RPC_INVALID_REQUEST).toBe(-32600);
      expect(RPC_METHOD_NOT_FOUND).toBe(-32601);
      expect(RPC_INVALID_PARAMS).toBe(-32602);
      expect(RPC_INTERNAL_ERROR).toBe(-32603);
    });
  });

  describe("ACP_PROTOCOL_VERSION", () => {
    it("is a valid semver string", () => {
      expect(ACP_PROTOCOL_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    });
  });
});
