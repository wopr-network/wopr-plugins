import { describe, expect, it, vi } from "vitest";

// Mock MCP SDK transports
vi.mock("@modelcontextprotocol/sdk/client/stdio.js", () => ({
  StdioClientTransport: vi.fn().mockImplementation(function (opts: unknown) {
    return { type: "stdio", opts };
  }),
}));
vi.mock("@modelcontextprotocol/sdk/client/sse.js", () => ({
  SSEClientTransport: vi.fn().mockImplementation(function (url: unknown, opts: unknown) {
    return { type: "sse", url, opts };
  }),
}));
vi.mock("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({
  StreamableHTTPClientTransport: vi.fn().mockImplementation(function (url: unknown, opts: unknown) {
    return { type: "http", url, opts };
  }),
}));

import { createTransport } from "../src/transports.js";

describe("createTransport", () => {
  it("should create StdioClientTransport for stdio kind", () => {
    const transport = createTransport({ name: "test", kind: "stdio", cmd: "npx", args: ["-y", "pkg"] });
    expect(transport).toBeDefined();
  });

  it("should create SSEClientTransport for sse kind", () => {
    const transport = createTransport({ name: "test", kind: "sse", url: "https://example.com/sse" });
    expect(transport).toBeDefined();
  });

  it("should create StreamableHTTPClientTransport for http kind", () => {
    const transport = createTransport({ name: "test", kind: "http", url: "https://example.com" });
    expect(transport).toBeDefined();
  });
});
