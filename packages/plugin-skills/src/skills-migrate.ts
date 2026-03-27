import { existsSync, readFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import type { WOPRPluginContext } from "@wopr-network/plugin-types";
import { logger } from "./logger.js";
import { REGISTRIES_FILE, WOPR_HOME } from "./paths.js";
import { addRegistry } from "./registries-repository.js";
import { initSkillsStorage, setPluginContext } from "./skills-repository.js";
import type { SkillStateRecord } from "./skills-schema.js";

const SKILLS_STATE_FILE = join(WOPR_HOME, "skills-state.json");

/** Main migration entry point — idempotent */
export async function migrateSkillsToSQL(ctx: WOPRPluginContext): Promise<void> {
  // Check if skills-state.json exists — if not, nothing to migrate
  if (!existsSync(SKILLS_STATE_FILE)) {
    logger.info("[migration] No skills-state.json found, skipping migration");
    return;
  }

  logger.info("[migration] Starting skills state migration from JSON to SQL");

  // Ensure storage is initialized
  setPluginContext(ctx);
  await initSkillsStorage();
  const skillsRepo = ctx.storage.getRepository<SkillStateRecord>("skills", "skills_state");

  // Read skills-state.json
  let skillsState: Record<string, { enabled: boolean }>;
  try {
    const raw = readFileSync(SKILLS_STATE_FILE, "utf-8");
    skillsState = JSON.parse(raw) as Record<string, { enabled: boolean }>;
  } catch (error: unknown) {
    logger.error("[migration] Failed to parse skills-state.json:", error);
    return;
  }

  // Migrate each skill state entry
  let migratedCount = 0;
  for (const [skillName, state] of Object.entries(skillsState)) {
    try {
      await migrateSkillState(skillName, state, skillsRepo, ctx);
      migratedCount++;
    } catch (error: unknown) {
      logger.error(`[migration] Failed to migrate skill state "${skillName}":`, error);
    }
  }

  logger.info(`[migration] Migrated ${migratedCount} skill states to SQL`);

  // Backup old file
  backupFile(SKILLS_STATE_FILE);

  logger.info("[migration] Backup of skills-state.json complete");
}

async function migrateSkillState(
  skillName: string,
  state: { enabled: boolean },
  skillsRepo: ReturnType<WOPRPluginContext["storage"]["getRepository"]>,
  _ctx: WOPRPluginContext,
): Promise<void> {
  logger.debug(`[migration] Migrating skill state "${skillName}" (enabled: ${state.enabled})`);

  const now = new Date().toISOString();
  await skillsRepo.insert({
    id: skillName,
    enabled: state.enabled,
    installed: true,
    enabledAt: state.enabled ? now : undefined,
    useCount: 0,
  });
}

/** Migrate registries.json to plugin SQL storage — idempotent */
export async function migrateRegistriesToSQL(): Promise<void> {
  if (!existsSync(REGISTRIES_FILE)) {
    logger.info("[migration] No registries.json found, skipping registry migration");
    return;
  }

  logger.info("[migration] Starting registry migration from JSON to SQL");

  // Ensure storage is initialized
  await initSkillsStorage();

  let registries: Array<{ name: string; url: string }>;
  try {
    const raw = readFileSync(REGISTRIES_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error("Expected array");
    registries = parsed as Array<{ name: string; url: string }>;
  } catch (error: unknown) {
    logger.error("[migration] Failed to parse registries.json:", error);
    return;
  }

  let migratedCount = 0;
  for (const reg of registries) {
    if (!reg || typeof reg.name !== "string" || typeof reg.url !== "string") {
      logger.warn("[migration] Skipping malformed registry entry:", reg);
      continue;
    }
    try {
      await addRegistry(reg.name, reg.url);
      migratedCount++;
    } catch (error: unknown) {
      // Skip duplicates (already migrated)
      const msg = error instanceof Error ? error.message : String(error);
      if (!msg.includes("already exists")) {
        logger.error(`[migration] Failed to migrate registry "${reg.name}":`, error);
      }
    }
  }

  logger.info(`[migration] Migrated ${migratedCount} registries to SQL`);
  backupFile(REGISTRIES_FILE);
  logger.info("[migration] Backup of registries.json complete");
}

function backupFile(filePath: string): void {
  if (existsSync(filePath)) {
    renameSync(filePath, `${filePath}.backup`);
    logger.debug(`[migration] Backed up ${filePath}`);
  }
}
