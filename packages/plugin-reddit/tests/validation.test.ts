import { describe, expect, it } from "vitest";
import {
  keywordListSchema,
  pollIntervalSchema,
  redditUsernameSchema,
  subredditListSchema,
  subredditNameSchema,
} from "../src/validation.js";

describe("validation", () => {
  describe("redditUsernameSchema", () => {
    it("accepts valid usernames", () => {
      expect(redditUsernameSchema.parse("test_user")).toBe("test_user");
      expect(redditUsernameSchema.parse("Bot-123")).toBe("Bot-123");
    });
    it("rejects invalid usernames", () => {
      expect(() => redditUsernameSchema.parse("ab")).toThrow(); // too short
      expect(() => redditUsernameSchema.parse("user name")).toThrow(); // space
    });
  });

  describe("subredditNameSchema", () => {
    it("accepts valid subreddit names", () => {
      expect(subredditNameSchema.parse("programming")).toBe("programming");
    });
    it("rejects invalid subreddit names", () => {
      expect(() => subredditNameSchema.parse("a")).toThrow(); // too short
      expect(() => subredditNameSchema.parse("sub reddit")).toThrow(); // space
    });
  });

  describe("subredditListSchema", () => {
    it("parses comma-separated subreddits and strips r/ prefix", () => {
      const result = subredditListSchema.parse("r/programming, rust, r/typescript");
      expect(result).toEqual(["programming", "rust", "typescript"]);
    });
  });

  describe("keywordListSchema", () => {
    it("parses and lowercases keywords", () => {
      const result = keywordListSchema.parse("WOPR, AI Bot, ChatGPT");
      expect(result).toEqual(["wopr", "ai bot", "chatgpt"]);
    });
  });

  describe("pollIntervalSchema", () => {
    it("defaults to 30", () => {
      expect(pollIntervalSchema.parse(undefined)).toBe(30);
    });
    it("rejects below 10", () => {
      expect(() => pollIntervalSchema.parse(5)).toThrow();
    });
  });
});
