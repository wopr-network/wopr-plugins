import { describe, expect, it } from "vitest";
import { extractFullExchange, extractHeuristic } from "../src/extractor.js";

describe("extractHeuristic", () => {
  it("returns null for short, untriggered exchange", () => {
    expect(extractHeuristic("hi", "hello", 300)).toBeNull();
  });

  it("triggers on 'remember that' phrase", () => {
    const result = extractHeuristic("Please remember that I prefer TypeScript", "Got it.", 300);
    expect(result).not.toBeNull();
    expect(result?.tags).toContain("triggered");
    expect(result?.content).toContain("TypeScript");
  });

  it("triggers on 'my name is' phrase", () => {
    const result = extractHeuristic("My name is Alice", "Nice to meet you, Alice!", 300);
    expect(result).not.toBeNull();
    expect(result?.tags).toContain("triggered");
  });

  it("triggers on 'from now on' phrase", () => {
    const result = extractHeuristic("From now on always use bun, not npm", "Understood.", 300);
    expect(result).not.toBeNull();
    expect(result?.tags).toContain("triggered");
  });

  it("triggers on long exchange even without keyword", () => {
    const longUser = "a".repeat(200);
    const longAssistant = "b".repeat(200);
    const result = extractHeuristic(longUser, longAssistant, 300);
    expect(result).not.toBeNull();
    expect(result?.tags).toContain("long-exchange");
    expect(result?.tags).not.toContain("triggered");
  });

  it("truncates content at 1200 chars per side", () => {
    const longMsg = "x".repeat(2000);
    const result = extractHeuristic("Remember this: " + longMsg, longMsg, 100);
    expect(result).not.toBeNull();
    // content should be truncated
    expect(result?.content.length).toBeLessThan(3000);
  });

  it("summary is first 200 chars of user message", () => {
    const msg = "a".repeat(500);
    const result = extractHeuristic("Important: " + msg, "ok", 100);
    expect(result?.summary.length).toBe(200);
  });
});

describe("extractFullExchange", () => {
  it("always returns a result", () => {
    const result = extractFullExchange("hi", "hello");
    expect(result).not.toBeNull();
    expect(result.tags).toContain("exchange");
  });

  it("includes both user and assistant content", () => {
    const result = extractFullExchange("Question?", "Answer.");
    expect(result.content).toContain("Question?");
    expect(result.content).toContain("Answer.");
  });

  it("truncates messages at 2000 chars", () => {
    const long = "x".repeat(3000);
    const result = extractFullExchange(long, long);
    expect(result.content.length).toBeLessThan(5000);
  });
});
