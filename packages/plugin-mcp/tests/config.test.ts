import { describe, expect, it } from "vitest";
import { PluginConfigSchema } from "../src/config.js";

describe("PluginConfigSchema", () => {
  it("should accept valid stdio server config", () => {
    const result = PluginConfigSchema.parse({
      servers: [{ name: "gmail", kind: "stdio", cmd: "npx", args: ["-y", "@modelcontextprotocol/server-gmail"] }],
    });
    expect(result.servers).toHaveLength(1);
    expect(result.servers[0].kind).toBe("stdio");
  });

  it("should accept valid SSE server config", () => {
    const result = PluginConfigSchema.parse({
      servers: [{ name: "linear", kind: "sse", url: "https://mcp.linear.app/sse" }],
    });
    expect(result.servers[0].kind).toBe("sse");
  });

  it("should accept valid HTTP server config", () => {
    const result = PluginConfigSchema.parse({
      servers: [{ name: "stripe", kind: "http", url: "https://mcp.stripe.com" }],
    });
    expect(result.servers[0].kind).toBe("http");
  });

  it("should default servers to empty array", () => {
    const result = PluginConfigSchema.parse({});
    expect(result.servers).toEqual([]);
  });

  it("should reject invalid kind", () => {
    expect(() =>
      PluginConfigSchema.parse({ servers: [{ name: "bad", kind: "grpc", url: "http://x" }] }),
    ).toThrow();
  });

  it("should reject stdio without cmd", () => {
    expect(() =>
      PluginConfigSchema.parse({ servers: [{ name: "bad", kind: "stdio" }] }),
    ).toThrow();
  });

  it("should reject SSE without url", () => {
    expect(() =>
      PluginConfigSchema.parse({ servers: [{ name: "bad", kind: "sse" }] }),
    ).toThrow();
  });

  it("should accept optional env for stdio", () => {
    const result = PluginConfigSchema.parse({
      servers: [{ name: "test", kind: "stdio", cmd: "node", env: { API_KEY: "abc" } }],
    });
    expect(result.servers[0].kind === "stdio" && result.servers[0].env).toEqual({ API_KEY: "abc" });
  });

  it("should accept optional headers for SSE", () => {
    const result = PluginConfigSchema.parse({
      servers: [{ name: "test", kind: "sse", url: "https://example.com/sse", headers: { Authorization: "Bearer x" } }],
    });
    expect(result.servers[0].kind === "sse" && result.servers[0].headers).toEqual({ Authorization: "Bearer x" });
  });
});
