import { describe, expect, it } from "vitest";
import { pluginManifest } from "../src/index.js";

describe("pluginManifest", () => {
  it("has provides field with capabilities array", () => {
    expect(pluginManifest).toHaveProperty("provides");
    expect(pluginManifest.provides).toHaveProperty("capabilities");
    expect(Array.isArray(pluginManifest.provides?.capabilities)).toBe(true);
    expect(pluginManifest.provides?.capabilities.length).toBeGreaterThan(0);
    const cap = pluginManifest.provides?.capabilities[0];
    expect(cap).toMatchObject({
      type: "channel",
      id: "signal",
      displayName: expect.any(String),
    });
  });

  it("has lifecycle field", () => {
    expect(pluginManifest).toHaveProperty("lifecycle");
    expect(pluginManifest.lifecycle).toMatchObject({
      shutdownBehavior: "graceful",
    });
  });
});
