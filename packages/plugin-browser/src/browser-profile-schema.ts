/**
 * Browser profile storage schema.
 *
 * Defines the SQL schema for browser profiles, cookies, and localStorage
 * using the WOPR plugin storage API.
 */

import type { PluginSchema } from "@wopr-network/plugin-types";
import { z } from "zod";

export const BrowserProfileSchema = z.object({
  id: z.string(),
  name: z.string(),
  userAgent: z.string().optional(),
  viewport: z.string().optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export type BrowserProfileRow = z.infer<typeof BrowserProfileSchema>;

export const BrowserCookieSchema = z.object({
  id: z.string(),
  profileId: z.string(),
  name: z.string(),
  value: z.string(),
  domain: z.string(),
  path: z.string(),
  expiresAt: z.number().optional(),
  httpOnly: z.number(),
  secure: z.number(),
  sameSite: z.string().optional(),
});

export type BrowserCookieRow = z.infer<typeof BrowserCookieSchema>;

export const BrowserLocalStorageSchema = z.object({
  id: z.string(),
  profileId: z.string(),
  origin: z.string(),
  key: z.string(),
  value: z.string(),
});

export type BrowserLocalStorageRow = z.infer<typeof BrowserLocalStorageSchema>;

export const browserProfilePluginSchema: PluginSchema = {
  namespace: "browser",
  version: 1,
  tables: {
    profiles: {
      schema: BrowserProfileSchema,
      primaryKey: "id",
      indexes: [{ fields: ["name"], unique: true }],
    },
    cookies: {
      schema: BrowserCookieSchema,
      primaryKey: "id",
      indexes: [{ fields: ["profileId"] }],
    },
    localStorage: {
      schema: BrowserLocalStorageSchema,
      primaryKey: "id",
      indexes: [{ fields: ["profileId"] }, { fields: ["origin"] }],
    },
  },
};
