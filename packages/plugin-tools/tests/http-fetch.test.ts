import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHttpFetchHandler } from "../src/http-fetch.js";
import type { ToolsPluginConfig } from "../src/types.js";

const mockFetch = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

function makeConfig(overrides: Partial<ToolsPluginConfig> = {}): ToolsPluginConfig {
  return { ...overrides };
}

function makeResponse(status: number, statusText: string, body: string, contentType = "text/plain") {
  return {
    status,
    statusText,
    headers: {
      get: (key: string) => (key === "content-type" ? contentType : null),
      forEach: (_cb: (value: string, key: string) => void) => {},
    },
    text: async () => body,
    json: async () => JSON.parse(body),
  };
}

describe("createHttpFetchHandler", () => {
  it("returns HTTP response with status code", async () => {
    mockFetch.mockResolvedValueOnce(makeResponse(200, "OK", "hello world"));
    const handler = createHttpFetchHandler(() => makeConfig());
    const result = await handler({ url: "https://example.com" });
    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain("HTTP 200 OK");
    expect(result.content[0].text).toContain("hello world");
  });

  it("handles JSON responses", async () => {
    const json = JSON.stringify({ key: "value" });
    mockFetch.mockResolvedValueOnce(makeResponse(200, "OK", json, "application/json"));
    const handler = createHttpFetchHandler(() => makeConfig());
    const result = await handler({ url: "https://example.com" });
    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain('"key": "value"');
  });

  it("handles text responses", async () => {
    mockFetch.mockResolvedValueOnce(makeResponse(200, "OK", "<html>page</html>", "text/html"));
    const handler = createHttpFetchHandler(() => makeConfig());
    const result = await handler({ url: "https://example.com" });
    expect(result.content[0].text).toContain("<html>page</html>");
  });

  it("truncates long responses", async () => {
    const longBody = "x".repeat(20000);
    mockFetch.mockResolvedValueOnce(makeResponse(200, "OK", longBody));
    const handler = createHttpFetchHandler(() => makeConfig({ maxResponseSize: 10000 }));
    const result = await handler({ url: "https://example.com" });
    expect(result.content[0].text).toContain("... (truncated)");
    // The text field should not contain the full 20000 char body
    const text = result.content[0].text ?? "";
    expect(text.length).toBeLessThan(15000);
  });

  it("includes headers when requested", async () => {
    const resp = {
      status: 200,
      statusText: "OK",
      headers: {
        get: (key: string) => (key === "content-type" ? "text/plain" : null),
        forEach: (cb: (value: string, key: string) => void) => {
          cb("text/plain", "content-type");
          cb("gzip", "content-encoding");
        },
      },
      text: async () => "body",
      json: async () => ({}),
    };
    mockFetch.mockResolvedValueOnce(resp);
    const handler = createHttpFetchHandler(() => makeConfig());
    const result = await handler({ url: "https://example.com", includeHeaders: true });
    expect(result.content[0].text).toContain("content-type: text/plain");
  });

  it("handles fetch errors gracefully", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Network error"));
    const handler = createHttpFetchHandler(() => makeConfig());
    const result = await handler({ url: "https://example.com" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("HTTP request failed");
    expect(result.content[0].text).toContain("Network error");
  });

  it("handles timeout via AbortError", async () => {
    const abortError = new Error("The operation was aborted");
    abortError.name = "AbortError";
    mockFetch.mockRejectedValueOnce(abortError);
    const handler = createHttpFetchHandler(() => makeConfig());
    const result = await handler({ url: "https://example.com", timeout: 100 });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("HTTP request failed");
  });

  it("domain allowlist blocks disallowed domains", async () => {
    const handler = createHttpFetchHandler(() => makeConfig({ allowedDomains: ["api.example.com"] }));
    const result = await handler({ url: "https://evil.com/data" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Access denied");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("domain blocklist blocks metadata endpoint", async () => {
    const handler = createHttpFetchHandler(() => makeConfig({ blockedDomains: ["169.254.169.254"] }));
    const result = await handler({ url: "http://169.254.169.254/latest/meta-data/" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Access denied");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("blocklist overrides allowlist", async () => {
    const handler = createHttpFetchHandler(() =>
      makeConfig({ allowedDomains: ["evil.com"], blockedDomains: ["evil.com"] }),
    );
    const result = await handler({ url: "https://evil.com/data" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("blocked");
  });
});
