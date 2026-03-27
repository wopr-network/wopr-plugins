import { logger } from "./logger.js";
import { updateRegistryFetchStatus } from "./registries-repository.js";
import type { RegistryRecord } from "./skills-schema.js";

const FETCH_TIMEOUT_MS = 10_000;

export interface RegistrySkillEntry {
  name: string;
  description: string;
  source: string;
  version?: string;
  category?: string;
  tags?: string[];
  registry: string;
}

export interface RegistryManifest {
  name?: string;
  skills: Array<{
    name: string;
    description: string;
    source: string;
    version?: string;
    category?: string;
    tags?: string[];
  }>;
}

/** Fetch and parse a single registry manifest. */
export async function fetchRegistryManifest(url: string): Promise<RegistryManifest> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`Registry returned ${response.status} ${response.statusText}`);
    }
    const data = (await response.json()) as Record<string, unknown>;
    if (!Array.isArray(data.skills)) {
      throw new Error("Invalid registry manifest: missing skills array");
    }
    return data as unknown as RegistryManifest;
  } finally {
    clearTimeout(timeout);
  }
}

/** Fetch all registries in parallel, returning aggregated skills and errors. */
export async function fetchAllRegistries(
  registries: RegistryRecord[],
): Promise<{ skills: RegistrySkillEntry[]; errors: Array<{ registry: string; error: string }> }> {
  if (registries.length === 0) {
    return { skills: [], errors: [] };
  }

  const allSkills: RegistrySkillEntry[] = [];
  const allErrors: Array<{ registry: string; error: string }> = [];

  const results = await Promise.allSettled(
    registries.map(async (reg) => {
      const manifest = await fetchRegistryManifest(reg.url);
      const now = new Date().toISOString();
      await updateRegistryFetchStatus(reg.id, now).catch(() => {});
      return { registry: reg, manifest };
    }),
  );

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    const reg = registries[i];
    if (result.status === "fulfilled") {
      for (const skill of result.value.manifest.skills) {
        allSkills.push({
          name: skill.name,
          description: skill.description,
          source: skill.source,
          version: skill.version,
          category: skill.category,
          tags: skill.tags,
          registry: reg.id,
        });
      }
    } else {
      const errMsg = result.reason instanceof Error ? result.reason.message : String(result.reason);
      allErrors.push({ registry: reg.id, error: errMsg });
      logger.warn(`[registry-fetcher] Failed to fetch registry "${reg.id}": ${errMsg}`);
      await updateRegistryFetchStatus(reg.id, new Date().toISOString(), errMsg).catch(() => {});
    }
  }

  return { skills: allSkills, errors: allErrors };
}
