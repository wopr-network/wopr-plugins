import { describe, expect, it } from "vitest";

describe("wopr-plugin-twitter", () => {
  it("exports a default plugin with correct shape", async () => {
    const mod = await import("../src/index.js");
    const plugin = mod.default;
    expect(plugin.name).toBe("wopr-plugin-twitter");
    expect(plugin.version).toBe("0.1.0");
    expect(typeof plugin.init).toBe("function");
    expect(typeof plugin.shutdown).toBe("function");
    expect(plugin.manifest?.capabilities).toContain("channel");
    expect(plugin.manifest?.provides?.capabilities[0].id).toBe("twitter");
  });
});
