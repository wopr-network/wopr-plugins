import { describe, it, expect } from "vitest";
import { createBrandVoiceProvider } from "../src/brand-voice.js";
import type { ProductInfo } from "../src/types.js";

describe("brand-voice", () => {
  const product: ProductInfo = {
    oneLiner: "AI bots that work for you",
    audience: "developers",
    voice: "punchy",
  };

  it("returns a ContextProvider with name 'evangelist-brand-voice'", () => {
    const provider = createBrandVoiceProvider(product);
    expect(provider.name).toBe("evangelist-brand-voice");
  });

  it("has priority 50", () => {
    const provider = createBrandVoiceProvider(product);
    expect(provider.priority).toBe(50);
  });

  it("getContext returns system-role context part with product info", async () => {
    const provider = createBrandVoiceProvider(product);
    const result = await provider.getContext("session-1", {
      content: "hello",
      from: "user",
      timestamp: Date.now(),
    });
    expect(result).not.toBeNull();
    expect(result!.role).toBe("system");
    expect(result!.content).toContain("AI bots that work for you");
    expect(result!.content).toContain("punchy");
    expect(result!.content).toContain("developers");
  });

  it("getContext returns null when product info is missing oneLiner", async () => {
    const provider = createBrandVoiceProvider({ oneLiner: "", audience: "developers", voice: "punchy" });
    const result = await provider.getContext("session-1", {
      content: "hello",
      from: "user",
      timestamp: Date.now(),
    });
    expect(result).toBeNull();
  });
});
