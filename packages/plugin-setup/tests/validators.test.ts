import { beforeEach, describe, expect, it, vi } from "vitest";
import { validateKey } from "../src/validators.js";

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

describe("validateKey", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("returns valid:true for anthropic when API returns 200", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true });
    const result = await validateKey("anthropic", "sk-ant-test");
    expect(result.valid).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith("https://api.anthropic.com/v1/models", {
      headers: { "x-api-key": "sk-ant-test", "anthropic-version": "2023-06-01" },
    });
  });

  it("returns valid:false for anthropic when API returns 401", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 401, text: async () => "invalid key" });
    const result = await validateKey("anthropic", "bad-key");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("401");
  });

  it("returns valid:true for openai when API returns 200", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true });
    const result = await validateKey("openai", "sk-test");
    expect(result.valid).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith("https://api.openai.com/v1/models", {
      headers: { Authorization: "Bearer sk-test" },
    });
  });

  it("returns valid:true for discord when API returns 200", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true });
    const result = await validateKey("discord", "bot-token");
    expect(result.valid).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith("https://discord.com/api/v10/users/@me", {
      headers: { Authorization: "Bot bot-token" },
    });
  });

  it("returns valid:true for telegram when API returns 200", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true });
    const result = await validateKey("telegram", "123:ABC");
    expect(result.valid).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith("https://api.telegram.org/bot123:ABC/getMe");
  });

  it("returns error for unknown provider", async () => {
    const result = await validateKey("unknown-provider", "key");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Unknown provider");
  });

  it("handles network errors gracefully", async () => {
    mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const result = await validateKey("anthropic", "key");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Network error");
  });
});
