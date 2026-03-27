import { describe, expect, it } from "vitest";
import { isValidSize, parseImaginePrompt } from "../../src/prompt-parser.js";

describe("parseImaginePrompt", () => {
  it("returns plain prompt with no flags", () => {
    const result = parseImaginePrompt("a cat in a tuxedo");
    expect(result).toEqual({ prompt: "a cat in a tuxedo" });
  });

  it("extracts --model flag and leaves rest as prompt", () => {
    const result = parseImaginePrompt("a cat --model flux");
    expect(result.prompt).toBe("a cat");
    expect(result.model).toBe("flux");
  });

  it("extracts --size flag", () => {
    const result = parseImaginePrompt("a cat --size 1024x1024");
    expect(result.prompt).toBe("a cat");
    expect(result.size).toBe("1024x1024");
  });

  it("extracts --style flag", () => {
    const result = parseImaginePrompt("a cat --style photorealistic");
    expect(result.prompt).toBe("a cat");
    expect(result.style).toBe("photorealistic");
  });

  it("extracts all flags together", () => {
    const result = parseImaginePrompt("a cat --model sdxl --size 512x512 --style anime");
    expect(result.prompt).toBe("a cat");
    expect(result.model).toBe("sdxl");
    expect(result.size).toBe("512x512");
    expect(result.style).toBe("anime");
  });

  it("handles flags at the beginning of the prompt", () => {
    const result = parseImaginePrompt("--model flux a cat in a tuxedo");
    expect(result.model).toBe("flux");
    expect(result.prompt).toBe("a cat in a tuxedo");
  });

  it("handles flags interspersed in the prompt", () => {
    const result = parseImaginePrompt("a cat --model flux in a tuxedo");
    expect(result.model).toBe("flux");
    expect(result.prompt).toBe("a cat  in a tuxedo".replace(/\s+/g, " ").trim());
  });

  it("leaves unknown flags in the prompt text", () => {
    const result = parseImaginePrompt("a cat --invalid value");
    expect(result.prompt).toContain("--invalid");
    expect(result.model).toBeUndefined();
  });

  it("returns empty prompt when all text is flags", () => {
    const result = parseImaginePrompt("--model flux --size 1024x1024 --style auto");
    expect(result.prompt).toBe("");
    expect(result.model).toBe("flux");
  });

  it("handles prompt with no flags — model is undefined", () => {
    const result = parseImaginePrompt("a dragon breathing fire");
    expect(result.model).toBeUndefined();
    expect(result.size).toBeUndefined();
    expect(result.style).toBeUndefined();
  });

  it("trims surrounding whitespace from prompt", () => {
    const result = parseImaginePrompt("  a cat  --model flux  ");
    expect(result.prompt).toBe("a cat");
  });
});

describe("isValidSize", () => {
  it("accepts 1024x1024 as valid", () => {
    expect(isValidSize("1024x1024")).toBe(true);
  });

  it("accepts 512x512 as valid", () => {
    expect(isValidSize("512x512")).toBe(true);
  });

  it("accepts 10x10 as valid (min 2 digits)", () => {
    expect(isValidSize("10x10")).toBe(true);
  });

  it("accepts landscape dimensions", () => {
    expect(isValidSize("1024x768")).toBe(true);
  });

  it("rejects plain text", () => {
    expect(isValidSize("abc")).toBe(false);
  });

  it("rejects single number with no x", () => {
    expect(isValidSize("1024")).toBe(false);
  });

  it("rejects x with no numbers", () => {
    expect(isValidSize("x")).toBe(false);
  });

  it("rejects 1-digit dimensions", () => {
    expect(isValidSize("5x5")).toBe(false);
  });

  it("rejects empty string", () => {
    expect(isValidSize("")).toBe(false);
  });
});
