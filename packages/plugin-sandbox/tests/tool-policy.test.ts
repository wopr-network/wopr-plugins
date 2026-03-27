import { describe, it, expect } from "vitest";
import {
  isToolAllowed,
  resolveSandboxToolPolicy,
  filterToolsByPolicy,
} from "../src/tool-policy.js";
import { DEFAULT_TOOL_ALLOW, DEFAULT_TOOL_DENY } from "../src/constants.js";

describe("tool-policy", () => {
  describe("isToolAllowed", () => {
    it("allows a tool when allow list is empty and deny list is empty", () => {
      expect(isToolAllowed({}, "exec_command")).toBe(true);
    });

    it("denies a tool that matches deny list", () => {
      expect(
        isToolAllowed({ deny: ["http_fetch"] }, "http_fetch")
      ).toBe(false);
    });

    it("allows a tool not in deny list", () => {
      expect(
        isToolAllowed({ deny: ["http_fetch"] }, "exec_command")
      ).toBe(true);
    });

    it("deny takes precedence over allow", () => {
      expect(
        isToolAllowed(
          { allow: ["http_fetch"], deny: ["http_fetch"] },
          "http_fetch"
        )
      ).toBe(false);
    });

    it("allows a tool matching allow list", () => {
      expect(
        isToolAllowed({ allow: ["exec_command"] }, "exec_command")
      ).toBe(true);
    });

    it("denies a tool not in allow list when allow list is non-empty", () => {
      expect(
        isToolAllowed({ allow: ["exec_command"] }, "http_fetch")
      ).toBe(false);
    });

    it("is case-insensitive", () => {
      expect(
        isToolAllowed({ allow: ["exec_command"] }, "EXEC_COMMAND")
      ).toBe(true);
      expect(
        isToolAllowed({ deny: ["HTTP_FETCH"] }, "http_fetch")
      ).toBe(false);
    });

    it("trims whitespace from tool name", () => {
      expect(
        isToolAllowed({ allow: ["exec_command"] }, "  exec_command  ")
      ).toBe(true);
    });

    // Glob/wildcard patterns
    it("supports wildcard * to match all", () => {
      expect(isToolAllowed({ allow: ["*"] }, "anything")).toBe(true);
    });

    it("supports wildcard in deny to block all", () => {
      expect(isToolAllowed({ deny: ["*"] }, "anything")).toBe(false);
    });

    it("supports prefix glob patterns", () => {
      expect(
        isToolAllowed({ allow: ["memory_*"] }, "memory_read")
      ).toBe(true);
      expect(
        isToolAllowed({ allow: ["memory_*"] }, "memory_write")
      ).toBe(true);
      expect(
        isToolAllowed({ allow: ["memory_*"] }, "exec_command")
      ).toBe(false);
    });

    it("supports suffix glob patterns", () => {
      expect(
        isToolAllowed({ deny: ["*_fetch"] }, "http_fetch")
      ).toBe(false);
      expect(
        isToolAllowed({ deny: ["*_fetch"] }, "data_fetch")
      ).toBe(false);
      expect(
        isToolAllowed({ deny: ["*_fetch"] }, "exec_command")
      ).toBe(true);
    });

    it("supports middle glob patterns", () => {
      expect(
        isToolAllowed({ allow: ["session*list"] }, "sessions_list")
      ).toBe(true);
      expect(
        isToolAllowed({ allow: ["session*list"] }, "session_some_list")
      ).toBe(true);
    });

    it("handles empty patterns in array gracefully", () => {
      // Empty string patterns get filtered out
      expect(isToolAllowed({ allow: ["", "exec_command"] }, "exec_command")).toBe(
        true
      );
    });

    it("handles non-array allow/deny gracefully", () => {
      // @ts-expect-error - testing runtime behavior
      expect(isToolAllowed({ allow: "not-array" }, "exec")).toBe(true);
      // @ts-expect-error - testing runtime behavior
      expect(isToolAllowed({ deny: "not-array" }, "exec")).toBe(true);
    });
  });

  describe("resolveSandboxToolPolicy", () => {
    it("returns defaults when no policy is provided", () => {
      const result = resolveSandboxToolPolicy({});
      expect(result.allow).toEqual([...DEFAULT_TOOL_ALLOW]);
      expect(result.deny).toEqual([...DEFAULT_TOOL_DENY]);
      expect(result.sources.allow.source).toBe("default");
      expect(result.sources.deny.source).toBe("default");
    });

    it("uses global policy when available", () => {
      const result = resolveSandboxToolPolicy({
        globalPolicy: {
          allow: ["exec_command"],
          deny: ["http_fetch"],
        },
      });
      expect(result.allow).toEqual(["exec_command"]);
      expect(result.deny).toEqual(["http_fetch"]);
      expect(result.sources.allow.source).toBe("global");
      expect(result.sources.deny.source).toBe("global");
    });

    it("session policy overrides global policy", () => {
      const result = resolveSandboxToolPolicy({
        globalPolicy: {
          allow: ["exec_command"],
          deny: ["http_fetch"],
        },
        sessionPolicy: {
          allow: ["read", "write"],
          deny: ["config_set"],
        },
      });
      expect(result.allow).toEqual(["read", "write"]);
      expect(result.deny).toEqual(["config_set"]);
      expect(result.sources.allow.source).toBe("session");
      expect(result.sources.deny.source).toBe("session");
    });

    it("mixes session and global sources for allow vs deny", () => {
      const result = resolveSandboxToolPolicy({
        globalPolicy: {
          allow: ["exec_command"],
        },
        sessionPolicy: {
          deny: ["http_fetch"],
        },
      });
      expect(result.allow).toEqual(["exec_command"]);
      expect(result.deny).toEqual(["http_fetch"]);
      expect(result.sources.allow.source).toBe("global");
      expect(result.sources.deny.source).toBe("session");
    });

    it("uses correct key paths in sources", () => {
      const result = resolveSandboxToolPolicy({
        sessionPolicy: { allow: ["x"], deny: ["y"] },
      });
      expect(result.sources.allow.key).toBe("sessions[].sandbox.tools.allow");
      expect(result.sources.deny.key).toBe("sessions[].sandbox.tools.deny");
    });
  });

  describe("filterToolsByPolicy", () => {
    it("separates tools into allowed and denied", () => {
      const result = filterToolsByPolicy(
        ["exec_command", "http_fetch", "read", "config_set"],
        { allow: ["exec_command", "read"], deny: ["config_set"] }
      );
      expect(result.allowed).toEqual(["exec_command", "read"]);
      expect(result.denied).toEqual(["http_fetch", "config_set"]);
    });

    it("allows all when no policy restrictions", () => {
      const result = filterToolsByPolicy(["a", "b", "c"], {});
      expect(result.allowed).toEqual(["a", "b", "c"]);
      expect(result.denied).toEqual([]);
    });

    it("denies all when deny is wildcard", () => {
      const result = filterToolsByPolicy(["a", "b"], { deny: ["*"] });
      expect(result.allowed).toEqual([]);
      expect(result.denied).toEqual(["a", "b"]);
    });

    it("handles empty tools list", () => {
      const result = filterToolsByPolicy([], { allow: ["x"] });
      expect(result.allowed).toEqual([]);
      expect(result.denied).toEqual([]);
    });

    it("works with glob patterns", () => {
      const result = filterToolsByPolicy(
        ["memory_read", "memory_write", "exec_command", "http_fetch"],
        { allow: ["memory_*", "exec_command"] }
      );
      expect(result.allowed).toEqual([
        "memory_read",
        "memory_write",
        "exec_command",
      ]);
      expect(result.denied).toEqual(["http_fetch"]);
    });
  });
});
