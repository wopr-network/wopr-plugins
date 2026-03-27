import { describe, it, expect } from "vitest";
import {
  DEFAULT_SANDBOX_IMAGE,
  DEFAULT_SANDBOX_CONTAINER_PREFIX,
  DEFAULT_SANDBOX_WORKDIR,
  DEFAULT_SANDBOX_WORKSPACE_ROOT,
  DEFAULT_SANDBOX_IDLE_HOURS,
  DEFAULT_SANDBOX_MAX_AGE_DAYS,
  DEFAULT_TOOL_ALLOW,
  DEFAULT_TOOL_DENY,
  SANDBOX_STATE_DIR,
  SANDBOX_REGISTRY_PATH,
} from "../src/constants.js";

describe("constants", () => {
  it("DEFAULT_SANDBOX_IMAGE is a valid Docker image reference", () => {
    expect(DEFAULT_SANDBOX_IMAGE).toBe("wopr-sandbox:bookworm-slim");
  });

  it("DEFAULT_SANDBOX_CONTAINER_PREFIX starts with wopr", () => {
    expect(DEFAULT_SANDBOX_CONTAINER_PREFIX).toBe("wopr-sbx-");
  });

  it("DEFAULT_SANDBOX_WORKDIR is an absolute path", () => {
    expect(DEFAULT_SANDBOX_WORKDIR).toBe("/workspace");
  });

  it("DEFAULT_SANDBOX_WORKSPACE_ROOT contains .wopr/sandboxes", () => {
    expect(DEFAULT_SANDBOX_WORKSPACE_ROOT).toContain(".wopr");
    expect(DEFAULT_SANDBOX_WORKSPACE_ROOT).toContain("sandboxes");
  });

  it("DEFAULT_SANDBOX_IDLE_HOURS is 24", () => {
    expect(DEFAULT_SANDBOX_IDLE_HOURS).toBe(24);
  });

  it("DEFAULT_SANDBOX_MAX_AGE_DAYS is 7", () => {
    expect(DEFAULT_SANDBOX_MAX_AGE_DAYS).toBe(7);
  });

  it("DEFAULT_TOOL_ALLOW contains expected tools", () => {
    expect(DEFAULT_TOOL_ALLOW).toContain("exec_command");
    expect(DEFAULT_TOOL_ALLOW).toContain("read");
    expect(DEFAULT_TOOL_ALLOW).toContain("write");
    expect(DEFAULT_TOOL_ALLOW).toContain("edit");
    expect(DEFAULT_TOOL_ALLOW).toContain("memory_read");
    expect(DEFAULT_TOOL_ALLOW).toContain("memory_write");
  });

  it("DEFAULT_TOOL_DENY blocks network and config tools", () => {
    expect(DEFAULT_TOOL_DENY).toContain("http_fetch");
    expect(DEFAULT_TOOL_DENY).toContain("config_set");
    expect(DEFAULT_TOOL_DENY).toContain("cron_schedule");
    expect(DEFAULT_TOOL_DENY).toContain("cron_once");
  });

  it("SANDBOX_STATE_DIR is under WOPR_HOME", () => {
    expect(SANDBOX_STATE_DIR).toContain("sandbox");
  });

  it("SANDBOX_REGISTRY_PATH ends with containers.json", () => {
    expect(SANDBOX_REGISTRY_PATH).toContain("containers.json");
  });
});
