import { describe, it, expect } from "vitest";
import plugin from "../src/index.js";

describe("plugin export", () => {
  it("exports a valid WOPRPlugin", () => {
    expect(plugin.name).toBe("wopr-plugin-evangelist");
    expect(plugin.version).toBe("0.1.0");
    expect(typeof plugin.init).toBe("function");
    expect(typeof plugin.shutdown).toBe("function");
  });

  it("manifest has category superpower", () => {
    expect(plugin.manifest?.category).toBe("superpower");
  });

  it("manifest requires channel capabilities", () => {
    const caps = plugin.manifest?.requires?.capabilities;
    expect(caps).toBeDefined();
    expect(caps?.some((c) => c.capability === "channel:twitter")).toBe(true);
    expect(caps?.some((c) => c.capability === "channel:reddit")).toBe(true);
  });

  it("manifest has configSchema with product fields", () => {
    const schema = plugin.manifest?.configSchema;
    expect(schema).toBeDefined();
    expect(schema?.fields.some((f) => f.name === "productOneLiner")).toBe(true);
    expect(schema?.fields.some((f) => f.name === "audience")).toBe(true);
    expect(schema?.fields.some((f) => f.name === "voice")).toBe(true);
  });
});
