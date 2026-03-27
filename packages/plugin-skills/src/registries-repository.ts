import { logger } from "./logger.js";
import { getPluginContext, initSkillsStorage } from "./skills-repository.js";
import type { RegistryRecord } from "./skills-schema.js";

function registriesRepo() {
  const ctx = getPluginContext();
  if (!ctx) {
    throw new Error("Plugin context not initialized");
  }
  return ctx.storage.getRepository<RegistryRecord>("skills", "skill_registries");
}

/** List all stored registries */
export async function listRegistries(): Promise<RegistryRecord[]> {
  await initSkillsStorage();
  const repo = registriesRepo();
  return repo.findMany({});
}

/** Add a new registry. Throws if name already exists. */
export async function addRegistry(name: string, url: string): Promise<RegistryRecord> {
  await initSkillsStorage();
  const repo = registriesRepo();
  const existing = await repo.findFirst({ id: name } as Parameters<typeof repo.findFirst>[0]);
  if (existing) {
    throw new Error(`Registry "${name}" already exists`);
  }
  const record: RegistryRecord = {
    id: name,
    url,
    addedAt: new Date().toISOString(),
  };
  await repo.insert(record);
  logger.debug(`[registries] Added registry "${name}"`);
  return record;
}

/** Remove a registry by name. Returns true if found and deleted. */
export async function removeRegistry(name: string): Promise<boolean> {
  await initSkillsStorage();
  const repo = registriesRepo();
  const existing = await repo.findFirst({ id: name } as Parameters<typeof repo.findFirst>[0]);
  if (!existing) {
    return false;
  }
  await repo.delete(existing.id);
  logger.debug(`[registries] Removed registry "${name}"`);
  return true;
}

/** Update fetch status for a registry. */
export async function updateRegistryFetchStatus(
  name: string,
  lastFetchedAt: string,
  lastError?: string,
): Promise<void> {
  await initSkillsStorage();
  const repo = registriesRepo();
  const existing = await repo.findFirst({ id: name } as Parameters<typeof repo.findFirst>[0]);
  if (existing) {
    await repo.update(existing.id, { lastFetchedAt, lastError });
  }
}
