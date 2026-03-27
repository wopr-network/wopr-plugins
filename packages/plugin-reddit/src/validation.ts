import { z } from "zod";

export const redditUsernameSchema = z
  .string()
  .min(3, "Reddit username must be at least 3 characters")
  .max(20, "Reddit username must be 20 characters or fewer")
  .regex(/^[a-zA-Z0-9_-]+$/, "Reddit username may only contain letters, numbers, hyphens, and underscores");

export const subredditNameSchema = z
  .string()
  .min(2, "Subreddit name must be at least 2 characters")
  .max(21, "Subreddit name must be 21 characters or fewer")
  .regex(/^[a-zA-Z0-9_]+$/, "Subreddit name may only contain letters, numbers, and underscores");

export const subredditListSchema = z
  .string()
  .transform((s) => s.split(",").map((sub) => sub.trim().replace(/^r\//, "")))
  .pipe(z.array(subredditNameSchema).min(1, "At least one subreddit required"));

export const keywordListSchema = z
  .string()
  .transform((s) => s.split(",").map((kw) => kw.trim().toLowerCase()))
  .pipe(z.array(z.string().min(1)).min(1, "At least one keyword required"));

export const pollIntervalSchema = z.coerce
  .number()
  .min(10, "Polling interval must be at least 10 seconds")
  .max(300, "Polling interval must be 300 seconds or fewer")
  .default(30);
