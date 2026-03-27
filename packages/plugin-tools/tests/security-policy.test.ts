import { describe, expect, it } from "vitest";
import { checkCommandPolicy, checkCwdPolicy, checkDomainPolicy, parseList } from "../src/security-policy.js";
import type { ToolsPluginConfig } from "../src/types.js";

describe("checkDomainPolicy", () => {
  it("allows all when no config", () => {
    const config: ToolsPluginConfig = {};
    expect(checkDomainPolicy("https://example.com/path", config)).toBeNull();
  });

  it("blocks listed domain", () => {
    const config: ToolsPluginConfig = { blockedDomains: ["evil.com"] };
    expect(checkDomainPolicy("http://evil.com/path", config)).toMatch(/blocked/);
  });

  it("blocks subdomain of blocked domain", () => {
    const config: ToolsPluginConfig = { blockedDomains: ["evil.com"] };
    expect(checkDomainPolicy("http://sub.evil.com/path", config)).toMatch(/blocked/);
  });

  it("allows unlisted domain with allowlist", () => {
    const config: ToolsPluginConfig = { allowedDomains: ["good.com"] };
    expect(checkDomainPolicy("http://good.com/api", config)).toBeNull();
  });

  it("allows subdomain of allowed domain", () => {
    const config: ToolsPluginConfig = { allowedDomains: ["good.com"] };
    expect(checkDomainPolicy("http://api.good.com/data", config)).toBeNull();
  });

  it("blocks unlisted domain with allowlist", () => {
    const config: ToolsPluginConfig = { allowedDomains: ["good.com"] };
    expect(checkDomainPolicy("http://other.com/path", config)).toMatch(/not in the allowed/);
  });

  it("blocklist takes priority over allowlist", () => {
    const config: ToolsPluginConfig = { allowedDomains: ["evil.com"], blockedDomains: ["evil.com"] };
    expect(checkDomainPolicy("http://evil.com/path", config)).toMatch(/blocked/);
  });

  it("returns error for invalid URL", () => {
    const config: ToolsPluginConfig = {};
    expect(checkDomainPolicy("not-a-url", config)).toMatch(/Invalid URL/);
  });
});

describe("checkCommandPolicy", () => {
  it("allows default safe command", () => {
    const config: ToolsPluginConfig = {};
    expect(checkCommandPolicy("ls -la", config)).toBeNull();
  });

  it("blocks unknown command", () => {
    const config: ToolsPluginConfig = {};
    expect(checkCommandPolicy("rm -rf /", config)).toMatch(/not allowed/);
  });

  it("blocks shell operators with default config", () => {
    const config: ToolsPluginConfig = {};
    expect(checkCommandPolicy("ls | grep foo", config)).toMatch(/Shell operators not allowed/);
  });

  it("blocks semicolons", () => {
    const config: ToolsPluginConfig = {};
    expect(checkCommandPolicy("ls; rm -rf /", config)).toMatch(/Shell operators not allowed/);
  });

  it("blocks && operator", () => {
    const config: ToolsPluginConfig = {};
    expect(checkCommandPolicy("ls && cat /etc/passwd", config)).toMatch(/Shell operators not allowed/);
  });

  it("blocks $( subshell", () => {
    const config: ToolsPluginConfig = {};
    expect(checkCommandPolicy("echo $(cat /etc/passwd)", config)).toMatch(/Shell operators not allowed/);
  });

  it("respects custom allowedCommands", () => {
    const config: ToolsPluginConfig = { allowedCommands: ["node", "ls"] };
    expect(checkCommandPolicy("node --version", config)).toBeNull();
    expect(checkCommandPolicy("cat file", config)).toMatch(/not allowed/);
  });

  it("allows shell operators when blockShellOperators is false", () => {
    const config: ToolsPluginConfig = { blockShellOperators: false };
    expect(checkCommandPolicy("ls | grep foo", config)).toBeNull();
  });

  it("blocks commands with /etc/shadow argument", () => {
    expect(checkCommandPolicy("cat /etc/shadow", {})).not.toBeNull();
  });

  it("blocks commands with /etc/passwd argument", () => {
    expect(checkCommandPolicy("cat /etc/passwd", {})).not.toBeNull();
  });

  it("blocks commands targeting /proc/self/environ", () => {
    expect(checkCommandPolicy("cat /proc/self/environ", {})).not.toBeNull();
  });

  it("allows normal file arguments", () => {
    expect(checkCommandPolicy("cat README.md", {})).toBeNull();
  });

  it("does not false-positive on path that contains sensitive path as substring", () => {
    // /home/user/notes-about-etc-passwd.txt is NOT /etc/passwd
    expect(checkCommandPolicy("cat /home/user/notes-about-etc-passwd.txt", {})).toBeNull();
    // /tmp/shadow-backup is NOT /etc/shadow
    expect(checkCommandPolicy("cat /tmp/shadow-backup", {})).toBeNull();
  });

  it("allows ls with no args", () => {
    expect(checkCommandPolicy("ls", {})).toBeNull();
  });
});

describe("checkCwdPolicy", () => {
  it("allows undefined cwd", () => {
    expect(checkCwdPolicy(undefined)).toBeNull();
  });

  it("allows absolute paths", () => {
    expect(checkCwdPolicy("/home/user/project")).toBeNull();
  });

  it("rejects relative paths", () => {
    expect(checkCwdPolicy("../etc")).not.toBeNull();
  });

  it("rejects paths with .. components", () => {
    expect(checkCwdPolicy("/home/user/../../../etc/passwd")).not.toBeNull();
  });

  it("rejects paths starting with /proc", () => {
    expect(checkCwdPolicy("/proc/self/environ")).not.toBeNull();
  });

  it("rejects paths starting with /sys", () => {
    expect(checkCwdPolicy("/sys/kernel")).not.toBeNull();
  });

  it("rejects paths starting with /dev", () => {
    expect(checkCwdPolicy("/dev/shm")).not.toBeNull();
  });

  it("allows normal working directories", () => {
    expect(checkCwdPolicy("/tmp/workdir")).toBeNull();
    expect(checkCwdPolicy("/home/user/project/src")).toBeNull();
  });
});

describe("parseList", () => {
  it("parses comma-separated string", () => {
    expect(parseList("a, b, c")).toEqual(["a", "b", "c"]);
  });

  it("returns array unchanged", () => {
    expect(parseList(["a", "b"])).toEqual(["a", "b"]);
  });

  it("returns empty array for non-string/non-array", () => {
    expect(parseList(null)).toEqual([]);
    expect(parseList(undefined)).toEqual([]);
    expect(parseList(42)).toEqual([]);
  });

  it("filters empty strings", () => {
    expect(parseList("a,,b")).toEqual(["a", "b"]);
  });
});
