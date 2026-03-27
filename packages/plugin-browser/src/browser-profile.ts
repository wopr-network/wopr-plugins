/**
 * Browser profile persistence using the WOPR plugin Storage API.
 *
 * Provides loadProfile/saveProfile for use in browser.ts.
 */

import { randomUUID } from "node:crypto";
import type { Repository, StorageApi } from "@wopr-network/plugin-types";
import {
  type BrowserCookieRow,
  type BrowserLocalStorageRow,
  type BrowserProfileRow,
  browserProfilePluginSchema,
} from "./browser-profile-schema.js";

export interface BrowserCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "Strict" | "Lax" | "None";
}

export type LocalStorageData = Record<string, Record<string, string>>;

export interface BrowserProfile {
  name: string;
  cookies: BrowserCookie[];
  localStorage: LocalStorageData;
  updatedAt: number;
}

let storage: StorageApi | null = null;

/**
 * Initialize browser profile storage (register schema).
 */
export async function initBrowserProfileStorage(storageApi: StorageApi): Promise<void> {
  storage = storageApi;
  if (!storage.isRegistered("browser")) {
    await storage.register(browserProfilePluginSchema);
  }
}

function getStorage(): StorageApi {
  if (!storage) {
    throw new Error("Browser profile storage not initialized. Call initBrowserProfileStorage() first.");
  }
  return storage;
}

async function ensureProfile(name: string): Promise<BrowserProfileRow> {
  const s = getStorage();
  const repo = s.getRepository<BrowserProfileRow>("browser", "profiles");
  const existing = await repo.findFirst({ name });
  if (existing) return existing;

  const now = Date.now();
  return repo.insert({
    id: randomUUID(),
    name,
    createdAt: now,
    updatedAt: now,
  });
}

export async function loadProfile(name: string): Promise<BrowserProfile> {
  const s = getStorage();
  const profile = await ensureProfile(name);
  const cookieRepo = s.getRepository<BrowserCookieRow>("browser", "cookies");
  const lsRepo = s.getRepository<BrowserLocalStorageRow>("browser", "localStorage");

  const cookieRows = await cookieRepo.findMany({ profileId: profile.id });
  const cookies: BrowserCookie[] = cookieRows.map((r) => ({
    name: r.name,
    value: r.value,
    domain: r.domain,
    path: r.path,
    expires: r.expiresAt ? Math.floor(r.expiresAt / 1000) : undefined,
    httpOnly: r.httpOnly === 1,
    secure: r.secure === 1,
    sameSite: r.sameSite as "Strict" | "Lax" | "None" | undefined,
  }));

  const lsRows = await lsRepo.findMany({ profileId: profile.id });
  const localStorage: LocalStorageData = {};
  for (const row of lsRows) {
    if (!localStorage[row.origin]) {
      localStorage[row.origin] = {};
    }
    localStorage[row.origin][row.key] = row.value;
  }

  return { name, cookies, localStorage, updatedAt: profile.updatedAt };
}

export async function saveProfile(profile: BrowserProfile): Promise<void> {
  const s = getStorage();
  const profileRow = await ensureProfile(profile.name);

  await s.transaction(async (txStorage: StorageApi) => {
    const cookieRepo: Repository<BrowserCookieRow> = txStorage.getRepository<BrowserCookieRow>("browser", "cookies");
    await cookieRepo.deleteMany({ profileId: profileRow.id });

    if (profile.cookies.length > 0) {
      const rows: BrowserCookieRow[] = profile.cookies.map((c) => ({
        id: randomUUID(),
        profileId: profileRow.id,
        name: c.name,
        value: c.value,
        domain: c.domain,
        path: c.path,
        expiresAt: c.expires ? c.expires * 1000 : undefined,
        httpOnly: c.httpOnly ? 1 : 0,
        secure: c.secure ? 1 : 0,
        sameSite: c.sameSite,
      }));
      await cookieRepo.insertMany(rows);
    }

    const lsRepo: Repository<BrowserLocalStorageRow> = txStorage.getRepository<BrowserLocalStorageRow>(
      "browser",
      "localStorage",
    );
    await lsRepo.deleteMany({ profileId: profileRow.id });

    const lsRows: BrowserLocalStorageRow[] = [];
    for (const [origin, kvMap] of Object.entries(profile.localStorage)) {
      for (const [key, value] of Object.entries(kvMap)) {
        lsRows.push({
          id: randomUUID(),
          profileId: profileRow.id,
          origin,
          key,
          value,
        });
      }
    }
    if (lsRows.length > 0) {
      await lsRepo.insertMany(lsRows);
    }
  });

  // Update profile timestamp
  const repo = s.getRepository<BrowserProfileRow>("browser", "profiles");
  await repo.update(profileRow.id, { updatedAt: Date.now() });
}

/**
 * Reset storage reference (called during plugin shutdown).
 */
export function resetStorage(): void {
  storage = null;
}

export async function listProfiles(): Promise<string[]> {
  const s = getStorage();
  const repo = s.getRepository<BrowserProfileRow>("browser", "profiles");
  const profiles = await repo.findMany();
  return profiles.map((p) => p.name);
}
