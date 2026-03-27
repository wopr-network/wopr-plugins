/**
 * Sandbox migration - migrate container registry from JSON to SQL
 */

import { existsSync, readFileSync, renameSync } from "node:fs";
import { SANDBOX_REGISTRY_PATH } from "./constants.js";
import { getLogger } from "./runtime.js";
import { updateRegistrySQL } from "./sandbox-repository.js";
import { sandboxRegistryRecordSchema } from "./sandbox-schema.js";

/**
 * Migrate sandbox registry from JSON file to SQL
 * Renames JSON file to .backup after successful migration
 */
export async function migrateSandboxRegistryToSql(): Promise<void> {
  const logger = getLogger();

  if (!existsSync(SANDBOX_REGISTRY_PATH)) {
    logger.info("[sandbox-migrate] No sandbox-registry.json found - clean SQL start");
    return;
  }

  try {
    const raw = readFileSync(SANDBOX_REGISTRY_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    const entries = parsed?.entries ?? [];
    let successCount = 0;
    let skipCount = 0;

    for (const entry of entries) {
      // Validate entry structure before inserting
      const result = sandboxRegistryRecordSchema.safeParse(entry);
      if (!result.success) {
        logger.warn(`[sandbox-migrate] Skipping invalid entry: ${result.error.message}`);
        skipCount++;
        continue;
      }
      await updateRegistrySQL(result.data);
      successCount++;
    }

    // Rename to backup
    renameSync(SANDBOX_REGISTRY_PATH, `${SANDBOX_REGISTRY_PATH}.backup`);
    logger.info(`[sandbox-migrate] Migrated ${successCount} entries from sandbox registry (${skipCount} skipped)`);
  } catch (err: unknown) {
    logger.error(`[sandbox-migrate] Failed to migrate: ${err}`);
    throw err;
  }
}
