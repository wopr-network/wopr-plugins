import { describe, it, expect, vi, beforeEach } from "vitest";
import { PassThrough } from "node:stream";
import { parseNdjsonLine, serializeNdjson, AcpServer } from "../src/server.js";
import type { AcpSessionBridge } from "../src/server.js";

describe("server", () => {
  describe("parseNdjsonLine", () => {
    it("parses valid JSON", () => {
      const result = parseNdjsonLine('{"key":"value"}');
      expect(result).toEqual({ key: "value" });
    });

    it("handles whitespace-padded JSON", () => {
      const result = parseNdjsonLine('  {"a":1}  ');
      expect(result).toEqual({ a: 1 });
    });

    it("returns null for empty string", () => {
      expect(parseNdjsonLine("")).toBeNull();
    });

    it("returns null for whitespace-only string", () => {
      expect(parseNdjsonLine("   ")).toBeNull();
    });

    it("returns null for invalid JSON", () => {
      expect(parseNdjsonLine("{invalid}")).toBeNull();
    });

    it("parses JSON arrays", () => {
      const result = parseNdjsonLine("[1,2,3]");
      expect(result).toEqual([1, 2, 3]);
    });

    it("parses primitives", () => {
      expect(parseNdjsonLine("42")).toBe(42);
      expect(parseNdjsonLine('"hello"')).toBe("hello");
      expect(parseNdjsonLine("true")).toBe(true);
      expect(parseNdjsonLine("null")).toBeNull();
    });
  });

  describe("serializeNdjson", () => {
    it("serializes an object with trailing newline", () => {
      const result = serializeNdjson({ id: 1, data: "test" });
      expect(result).toBe('{"id":1,"data":"test"}\n');
    });

    it("serializes primitives", () => {
      expect(serializeNdjson(42)).toBe("42\n");
      expect(serializeNdjson("hi")).toBe('"hi"\n');
    });
  });

  describe("AcpServer", () => {
    let input: PassThrough;
    let output: PassThrough;
    let bridge: AcpSessionBridge;
    let server: AcpServer;
    let outputData: string;

    function collectOutput(): string[] {
      return outputData
        .split("\n")
        .filter((l) => l.trim())
        .map((l) => JSON.parse(l));
    }

    beforeEach(() => {
      input = new PassThrough();
      output = new PassThrough();
      outputData = "";
      output.on("data", (chunk: Buffer) => {
        outputData += chunk.toString();
      });

      bridge = {
        inject: vi.fn().mockResolvedValue({
          response: "agent response",
          sessionId: "s1",
        }),
        cancelInject: vi.fn().mockReturnValue(true),
      };

      server = new AcpServer({
        bridge,
        defaultSession: "test",
        input,
        output,
        logger: {
          info: vi.fn(),
          warn: vi.fn(),
          error: vi.fn(),
          debug: vi.fn(),
        },
      });
    });

    function sendLine(obj: unknown): void {
      input.write(JSON.stringify(obj) + "\n");
    }

    async function flush(): Promise<void> {
      await new Promise((r) => setTimeout(r, 50));
    }

    it("starts and listens for NDJSON input", () => {
      server.start();
      expect(server.isClosed()).toBe(false);
    });

    it("handles initialize request", async () => {
      server.start();
      sendLine({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "0.1.0",
          clientInfo: { name: "Test", version: "1.0" },
        },
      });
      await flush();

      const messages = collectOutput();
      expect(messages).toHaveLength(1);
      const resp = messages[0] as any;
      expect(resp.jsonrpc).toBe("2.0");
      expect(resp.id).toBe(1);
      expect(resp.result.protocolVersion).toBe("0.1.0");
      expect(resp.result.serverInfo.name).toBe("wopr-acp");
      expect(resp.result.capabilities.context).toBe(true);
      expect(resp.result.capabilities.streaming).toBe(true);
    });

    it("rejects chat/message before initialize", async () => {
      server.start();
      sendLine({
        jsonrpc: "2.0",
        id: 2,
        method: "chat/message",
        params: { message: "hello" },
      });
      await flush();

      const messages = collectOutput();
      const resp = messages[0] as any;
      expect(resp.error).toBeDefined();
      expect(resp.error.message).toBe("Not initialized");
    });

    it("handles chat/message after initialize", async () => {
      server.start();
      sendLine({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "0.1.0",
          clientInfo: { name: "Test", version: "1.0" },
        },
      });
      await flush();
      outputData = "";

      sendLine({
        jsonrpc: "2.0",
        id: 2,
        method: "chat/message",
        params: { message: "hello world" },
      });
      await flush();

      expect(bridge.inject).toHaveBeenCalled();
      const messages = collectOutput();
      // Should have stream end notification + final response
      const finalResp = messages.find((m: any) => m.id === 2) as any;
      expect(finalResp).toBeDefined();
      expect(finalResp.result.content).toBe("agent response");
      expect(finalResp.result.sessionId).toBeDefined();
    });

    it("handles chat/cancel", async () => {
      server.start();
      sendLine({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "0.1.0",
          clientInfo: { name: "Test", version: "1.0" },
        },
      });
      await flush();

      // First send a message to create a session
      sendLine({
        jsonrpc: "2.0",
        id: 2,
        method: "chat/message",
        params: { message: "start", sessionId: "my-session" },
      });
      await flush();
      outputData = "";

      sendLine({
        jsonrpc: "2.0",
        id: 3,
        method: "chat/cancel",
        params: { sessionId: "my-session" },
      });
      await flush();

      const messages = collectOutput();
      const resp = messages.find((m: any) => m.id === 3) as any;
      expect(resp).toBeDefined();
      expect(resp.result.cancelled).toBe(true);
    });

    it("handles cancel for unknown session", async () => {
      server.start();
      sendLine({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "0.1.0",
          clientInfo: { name: "Test", version: "1.0" },
        },
      });
      await flush();
      outputData = "";

      sendLine({
        jsonrpc: "2.0",
        id: 2,
        method: "chat/cancel",
        params: { sessionId: "nonexistent" },
      });
      await flush();

      const messages = collectOutput();
      const resp = messages[0] as any;
      expect(resp.result.cancelled).toBe(false);
    });

    it("handles context/update", async () => {
      server.start();
      sendLine({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "0.1.0",
          clientInfo: { name: "Test", version: "1.0" },
        },
      });
      await flush();
      outputData = "";

      sendLine({
        jsonrpc: "2.0",
        id: 2,
        method: "context/update",
        params: {
          sessionId: "s1",
          context: {
            cursorPosition: { path: "a.ts", line: 1, column: 1 },
          },
        },
      });
      await flush();

      const messages = collectOutput();
      const resp = messages[0] as any;
      expect(resp.result.ok).toBe(true);
    });

    it("returns error for unknown method", async () => {
      server.start();
      sendLine({
        jsonrpc: "2.0",
        id: 1,
        method: "unknown/method",
        params: {},
      });
      await flush();

      const messages = collectOutput();
      const resp = messages[0] as any;
      expect(resp.error).toBeDefined();
      expect(resp.error.code).toBe(-32601);
      expect(resp.error.message).toContain("Unknown method");
    });

    it("returns parse error for invalid JSON", async () => {
      server.start();
      input.write("not json\n");
      await flush();

      const messages = collectOutput();
      const resp = messages[0] as any;
      expect(resp.error).toBeDefined();
      expect(resp.error.code).toBe(-32700);
    });

    it("returns error for invalid JSON-RPC version", async () => {
      server.start();
      sendLine({ jsonrpc: "1.0", id: 1, method: "initialize", params: {} });
      await flush();

      const messages = collectOutput();
      const resp = messages[0] as any;
      expect(resp.error).toBeDefined();
      expect(resp.error.code).toBe(-32600);
    });

    it("returns error for invalid params", async () => {
      server.start();
      sendLine({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { wrong: "field" },
      });
      await flush();

      const messages = collectOutput();
      const resp = messages[0] as any;
      expect(resp.error).toBeDefined();
      expect(resp.error.code).toBe(-32602);
    });

    it("close() is idempotent", () => {
      server.start();
      server.close();
      expect(server.isClosed()).toBe(true);
      server.close(); // second call should not throw
      expect(server.isClosed()).toBe(true);
    });

    it("does not send messages after close", async () => {
      server.start();
      server.close();
      sendLine({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "0.1.0",
          clientInfo: { name: "Test", version: "1.0" },
        },
      });
      await flush();

      // No output should be written after close
      // (handleLine still runs but send() is gated by this.closed)
      // The parse error response would appear, but send gates on closed
      expect(outputData).toBe("");
    });

    it("handles multiple NDJSON messages in single chunk", async () => {
      server.start();
      const line1 = JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "unknown1",
        params: {},
      });
      const line2 = JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "unknown2",
        params: {},
      });
      input.write(line1 + "\n" + line2 + "\n");
      await flush();

      const messages = collectOutput();
      expect(messages.length).toBe(2);
    });

    it("handles partial NDJSON lines across chunks", async () => {
      server.start();
      const msg = JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "unknown",
        params: {},
      });
      // Split the message across two chunks
      const mid = Math.floor(msg.length / 2);
      input.write(msg.slice(0, mid));
      await flush();
      expect(outputData).toBe(""); // nothing yet

      input.write(msg.slice(mid) + "\n");
      await flush();

      const messages = collectOutput();
      expect(messages.length).toBe(1);
    });

    it("skips blank lines", async () => {
      server.start();
      input.write("\n\n\n");
      await flush();
      expect(outputData).toBe("");
    });

    it("closes on stdin end", async () => {
      server.start();
      input.end();
      await flush();
      expect(server.isClosed()).toBe(true);
    });
  });
});
