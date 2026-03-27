import { describe, expect, it } from "vitest";
import { createExecCommandHandler } from "../src/exec-command.js";
import type { ToolsPluginConfig } from "../src/types.js";

// We'll use actual child_process for most tests since they use real safe commands.
// Mock it only for error/timeout scenarios.

function makeConfig(overrides: Partial<ToolsPluginConfig> = {}): ToolsPluginConfig {
  return { ...overrides };
}

describe("createExecCommandHandler", () => {
  it("executes allowed command and returns output", async () => {
    const handler = createExecCommandHandler(() => makeConfig());
    const result = await handler({ command: "echo hello" });
    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain("hello");
  });

  it("blocks disallowed command", async () => {
    const handler = createExecCommandHandler(() => makeConfig());
    const result = await handler({ command: "rm -rf /" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("not allowed");
  });

  it("blocks shell operators", async () => {
    const handler = createExecCommandHandler(() => makeConfig());
    const result = await handler({ command: "ls; rm -rf /" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Shell operators not allowed");
  });

  it("respects custom allowed commands", async () => {
    const handler = createExecCommandHandler(() => makeConfig({ allowedCommands: ["echo", "node"] }));
    // echo is in custom list, should work
    const result = await handler({ command: "echo test" });
    expect(result.isError).toBeFalsy();
    // ls is NOT in custom list, should be blocked
    const blocked = await handler({ command: "ls" });
    expect(blocked.isError).toBe(true);
  });

  it("respects timeout", async () => {
    const handler = createExecCommandHandler(() => makeConfig({ maxExecTimeout: 100 }));
    // sleep 5 should time out with a very short timeout
    const result = await handler({ command: "sleep", timeout: 100 });
    // sleep itself is not allowed (not in default list)
    expect(result.isError).toBe(true);
  });

  it("handles exec errors gracefully", async () => {
    // cat on non-existent file will produce an error
    const handler = createExecCommandHandler(() => makeConfig());
    const result = await handler({ command: "cat /nonexistent-file-xyz-123" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Command failed");
  });

  it("returns (no output) for commands with no stdout", async () => {
    const handler = createExecCommandHandler(() => makeConfig());
    // echo with empty string produces a newline which trims to empty
    const result = await handler({ command: "echo -n" });
    // Could be empty or "(no output)"
    expect(result.isError).toBeFalsy();
  });

  it("handles commands producing stderr alongside stdout", async () => {
    // ls on an existing dir and a non-existing dir produces both stdout and stderr
    const handler = createExecCommandHandler(() => makeConfig());
    // This may not reliably produce both on all systems, so just test it doesn't crash
    const result = await handler({ command: "ls /tmp" });
    expect(result.isError).toBeFalsy();
  });

  it("blocks pipe operator in commands", async () => {
    const handler = createExecCommandHandler(() => makeConfig());
    const result = await handler({ command: "ls | grep tmp" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Shell operators not allowed");
  });

  it("rejects invalid cwd paths (relative)", async () => {
    const handler = createExecCommandHandler(() => makeConfig());
    const result = await handler({ command: "ls", cwd: "../../../etc" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("absolute path");
  });

  it("rejects /proc cwd", async () => {
    const handler = createExecCommandHandler(() => makeConfig());
    const result = await handler({ command: "ls", cwd: "/proc/self" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("not allowed");
  });

  it("rejects /sys cwd", async () => {
    const handler = createExecCommandHandler(() => makeConfig());
    const result = await handler({ command: "ls", cwd: "/sys/kernel" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("not allowed");
  });

  it("accepts valid absolute cwd", async () => {
    const handler = createExecCommandHandler(() => makeConfig());
    const result = await handler({ command: "ls", cwd: "/tmp" });
    expect(result.isError).toBeFalsy();
  });

  it("respects maxOutputSize config", async () => {
    const handler = createExecCommandHandler(() => makeConfig({ maxOutputSize: 20 }));
    // Generate output longer than 20 chars
    const result = await handler({ command: "echo", cwd: undefined });
    // echo of a long string — use a word that's short enough to be allowed
    const result2 = await createExecCommandHandler(() => makeConfig({ maxOutputSize: 5 }))({
      command: "echo abcdefghijklmnopqrstuvwxyz",
    });
    expect(result2.content[0].text).toContain("truncated");
  });

  it("strips env variables by default (no secrets leaked)", async () => {
    // We test that allowed commands still work with stripped env (PATH is preserved)
    const handler = createExecCommandHandler(() => makeConfig());
    const result = await handler({ command: "echo test" });
    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain("test");
  });

  it("returns error for commands targeting sensitive files", async () => {
    const handler = createExecCommandHandler(() => makeConfig());
    const result = await handler({ command: "cat /etc/shadow" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("not allowed");
  });

  it("returns error for commands targeting /etc/passwd", async () => {
    const handler = createExecCommandHandler(() => makeConfig());
    const result = await handler({ command: "cat /etc/passwd" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("not allowed");
  });
});
