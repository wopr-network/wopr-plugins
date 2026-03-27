import { describe, it, expect } from "vitest";
import { mapHeadlineToAngle } from "../src/news-hooks.js";
import type { ProductInfo } from "../src/types.js";

describe("news-hooks", () => {
  const product: ProductInfo = {
    oneLiner: "AI bots that work for you",
    audience: "developers",
    voice: "punchy",
  };

  describe("mapHeadlineToAngle", () => {
    it("maps a price-related headline to a cost angle", () => {
      const angle = mapHeadlineToAngle("OpenAI cuts GPT-4 pricing by 50%", product);
      expect(angle).toContain("pricing");
    });

    it("maps a new-model headline to a compatibility angle", () => {
      const angle = mapHeadlineToAngle("Google releases Gemini 2.0", product);
      expect(angle).toContain("model");
    });

    it("returns a generic angle for unrelated headlines", () => {
      const angle = mapHeadlineToAngle("Weather forecast for tomorrow", product);
      expect(angle).toBeTruthy();
    });
  });
});
