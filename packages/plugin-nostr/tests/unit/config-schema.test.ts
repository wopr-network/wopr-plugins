import { afterEach, describe, expect, it, vi } from "vitest";
import plugin from "../../src/index.js";
import { createMockContext } from "../mocks/wopr-context.js";

describe("configSchema best practices", () => {
  it("nsec field has secret: true", () => {
    const nsecField = plugin.manifest.configSchema?.fields.find(
      (f) => f.name === "nsec",
    );
    expect(nsecField).toBeDefined();
    expect(nsecField!.secret).toBe(true);
  });

  it("nsec field has setupFlow: paste", () => {
    const nsecField = plugin.manifest.configSchema?.fields.find(
      (f) => f.name === "nsec",
    );
    expect(nsecField).toBeDefined();
    expect(nsecField!.setupFlow).toBe("paste");
  });

  it("manifest includes configSchema", () => {
    expect(plugin.manifest.configSchema).toBeDefined();
    expect(plugin.manifest.configSchema!.fields.length).toBeGreaterThan(0);
  });
});

describe("shutdown cleanup", () => {
  afterEach(async () => {
    await plugin.shutdown();
  });

  it("calls unregisterConfigSchema on shutdown", async () => {
    const ctx = createMockContext();
    ctx.getConfig = vi.fn().mockReturnValue({});
    await plugin.init(ctx);
    await plugin.shutdown();

    expect(ctx.unregisterConfigSchema).toHaveBeenCalledWith("wopr-plugin-nostr");
  });

  it("shutdown is idempotent (calling twice does not throw)", async () => {
    const ctx = createMockContext();
    ctx.getConfig = vi.fn().mockReturnValue({});
    await plugin.init(ctx);
    await plugin.shutdown();
    await plugin.shutdown(); // second call should not throw
  });
});
