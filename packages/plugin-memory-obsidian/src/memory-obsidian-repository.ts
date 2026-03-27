import type { Repository, StorageApi } from "@wopr-network/plugin-types";
import { type MemoryEntry, memoryObsidianSchema } from "./memory-obsidian-schema.js";

let repo: Repository<MemoryEntry> | null = null;

export async function initStorage(storage: StorageApi): Promise<void> {
  await storage.register(memoryObsidianSchema);
  repo = storage.getRepository<MemoryEntry>("memory-obsidian", "memories");
}

function getRepo(): Repository<MemoryEntry> {
  if (!repo) throw new Error("memory-obsidian storage not initialized");
  return repo;
}

export async function saveMemory(entry: MemoryEntry): Promise<MemoryEntry> {
  return getRepo().insert(entry);
}

export async function findBySession(sessionId: string): Promise<MemoryEntry[]> {
  return getRepo().findMany({ sessionId });
}

export async function findByVaultPath(vaultPath: string): Promise<MemoryEntry | null> {
  return getRepo().findFirst({ vaultPath });
}

export async function findById(id: string): Promise<MemoryEntry | null> {
  return getRepo().findById(id);
}

export async function findAll(): Promise<MemoryEntry[]> {
  return getRepo().findMany({});
}

export async function deleteMemory(id: string): Promise<boolean> {
  return getRepo().delete(id);
}
