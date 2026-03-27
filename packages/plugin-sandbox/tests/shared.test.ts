import { describe, it, expect } from "vitest";
import {
  slugifySessionKey,
  resolveSandboxWorkspaceDir,
  resolveSandboxScopeKey,
} from "../src/shared.js";
import path from "node:path";

describe("shared", () => {
  describe("slugifySessionKey", () => {
    it("converts to lowercase with hash suffix", () => {
      const result = slugifySessionKey("MySession");
      expect(result).toMatch(/^mysession-[a-f0-9]{8}$/);
    });

    it("replaces non-alphanumeric characters with hyphens", () => {
      const result = slugifySessionKey("my session!@#$%");
      expect(result).toMatch(/^my-session-[a-f0-9]{8}$/);
    });

    it("trims leading and trailing hyphens from slug", () => {
      const result = slugifySessionKey("--test--");
      expect(result).toMatch(/^test-[a-f0-9]{8}$/);
    });

    it("falls back to 'session' for empty string", () => {
      const result = slugifySessionKey("");
      expect(result).toMatch(/^session-[a-f0-9]{8}$/);
    });

    it("falls back to 'session' for whitespace-only string", () => {
      const result = slugifySessionKey("   ");
      expect(result).toMatch(/^session-[a-f0-9]{8}$/);
    });

    it("truncates long names to 32 chars before hash", () => {
      const longName = "a".repeat(100);
      const result = slugifySessionKey(longName);
      const parts = result.split("-");
      // base is max 32 chars
      expect(parts[0].length).toBeLessThanOrEqual(32);
    });

    it("produces deterministic output for same input", () => {
      const a = slugifySessionKey("test-session");
      const b = slugifySessionKey("test-session");
      expect(a).toBe(b);
    });

    it("produces different output for different inputs", () => {
      const a = slugifySessionKey("session-1");
      const b = slugifySessionKey("session-2");
      expect(a).not.toBe(b);
    });

    it("preserves dots, hyphens, and underscores", () => {
      const result = slugifySessionKey("my.session_name-v1");
      expect(result).toMatch(/^my\.session_name-v1-[a-f0-9]{8}$/);
    });
  });

  describe("resolveSandboxWorkspaceDir", () => {
    it("joins root with slugified session key", () => {
      const result = resolveSandboxWorkspaceDir("/root", "my-session");
      const slug = slugifySessionKey("my-session");
      expect(result).toBe(path.join("/root", slug));
    });

    it("handles root with trailing slash", () => {
      const result = resolveSandboxWorkspaceDir("/root/", "test");
      expect(result).toContain("/root/");
    });
  });

  describe("resolveSandboxScopeKey", () => {
    it("returns 'shared' for shared scope", () => {
      expect(resolveSandboxScopeKey("shared", "any-session")).toBe("shared");
    });

    it("returns session key for session scope", () => {
      expect(resolveSandboxScopeKey("session", "my-session")).toBe(
        "my-session"
      );
    });

    it("trims whitespace from session key", () => {
      expect(resolveSandboxScopeKey("session", "  my-session  ")).toBe(
        "my-session"
      );
    });

    it("falls back to 'main' for empty session key", () => {
      expect(resolveSandboxScopeKey("session", "")).toBe("main");
      expect(resolveSandboxScopeKey("session", "   ")).toBe("main");
    });
  });
});
