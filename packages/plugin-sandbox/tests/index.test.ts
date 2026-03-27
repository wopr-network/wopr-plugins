import { describe, it, expect } from "vitest";
import plugin from "../src/index.js";

describe("plugin export", () => {
  it("has required manifest fields", () => {
    expect(plugin.name).toBe("wopr-plugin-sandbox");
    expect(plugin.version).toBe("1.0.0");
    expect(plugin.description).toBeTruthy();
    expect(plugin.manifest).toBeDefined();
    expect(plugin.manifest?.category).toBe("infrastructure");
    expect(plugin.manifest?.capabilities).toContain("sandbox");
    expect(plugin.manifest?.lifecycle).toBeDefined();
  });

  it("shutdown is idempotent (can be called twice without error)", async () => {
    // shutdown before init should not throw
    await plugin.shutdown?.();
    await plugin.shutdown?.();
  });
});
