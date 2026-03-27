import { describe, it, expect } from "vitest";
import { buildContentPrompt, platformGuidelines } from "../src/content-engine.js";
import type { ProductInfo } from "../src/types.js";

describe("content-engine", () => {
  const product: ProductInfo = {
    oneLiner: "AI bots that work for you",
    audience: "developers",
    voice: "punchy",
  };

  describe("platformGuidelines", () => {
    it("returns twitter guidelines with character limit", () => {
      const g = platformGuidelines("twitter");
      expect(g).toContain("280");
    });

    it("returns reddit guidelines mentioning depth", () => {
      const g = platformGuidelines("reddit");
      expect(g).toContain("depth");
    });

    it("returns discord guidelines mentioning casual", () => {
      const g = platformGuidelines("discord");
      expect(g).toContain("casual");
    });

    it("returns generic guidelines for unknown platform", () => {
      const g = platformGuidelines("mastodon");
      expect(g).toBeTruthy();
    });
  });

  describe("buildContentPrompt", () => {
    it("includes product one-liner in the prompt", () => {
      const prompt = buildContentPrompt(product, "twitter", "Launch a new feature thread");
      expect(prompt).toContain("AI bots that work for you");
    });

    it("includes the topic", () => {
      const prompt = buildContentPrompt(product, "reddit", "Compare us to competitor X");
      expect(prompt).toContain("Compare us to competitor X");
    });

    it("includes platform-specific guidelines", () => {
      const prompt = buildContentPrompt(product, "twitter", "anything");
      expect(prompt).toContain("280");
    });
  });
});
