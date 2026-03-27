/**
 * Cron repository - async CRUD operations for cron jobs and runs
 */

import { randomUUID } from "node:crypto";
import type { Filter, Repository, StorageApi } from "@wopr-network/plugin-types";
import type { CronJobRow, CronRunRow } from "./cron-schema.js";
import { cronPluginSchema } from "./cron-schema.js";

let jobsRepo: Repository<CronJobRow> | null = null;
let runsRepo: Repository<CronRunRow> | null = null;

/**
 * Initialize cron storage (registers schema and gets repositories)
 */
export async function initCronStorage(storage: StorageApi): Promise<void> {
  await storage.register(cronPluginSchema);
  jobsRepo = storage.getRepository<CronJobRow>("cron", "jobs");
  runsRepo = storage.getRepository<CronRunRow>("cron", "runs");
}

function getJobsRepo(): Repository<CronJobRow> {
  if (!jobsRepo) throw new Error("Cron storage not initialized - call initCronStorage() first");
  return jobsRepo;
}

function getRunsRepo(): Repository<CronRunRow> {
  if (!runsRepo) throw new Error("Cron storage not initialized - call initCronStorage() first");
  return runsRepo;
}

/**
 * Get all cron jobs
 */
export async function getCrons(): Promise<CronJobRow[]> {
  return await getJobsRepo().findMany();
}

/**
 * Get a specific cron job by name
 */
export async function getCron(name: string): Promise<CronJobRow | null> {
  return await getJobsRepo().findById(name);
}

/**
 * Add or update a cron job (upsert by name)
 */
export async function addCron(job: CronJobRow): Promise<void> {
  const repo = getJobsRepo();
  const existing = await repo.findById(job.name);
  if (existing) {
    await repo.update(job.name, job);
  } else {
    await repo.insert(job);
  }
}

/**
 * Remove a cron job by name
 */
export async function removeCron(name: string): Promise<boolean> {
  return await getJobsRepo().delete(name);
}

/**
 * Add a cron run entry to history
 */
export async function addCronRun(run: Omit<CronRunRow, "id">): Promise<void> {
  const id = randomUUID();
  await getRunsRepo().insert({ id, ...run });
}

/**
 * Get cron run history with filtering and pagination
 */
export async function getCronHistory(options?: {
  name?: string;
  session?: string;
  limit?: number;
  offset?: number;
  since?: number;
  successOnly?: boolean;
  failedOnly?: boolean;
}): Promise<{ entries: CronRunRow[]; total: number; hasMore: boolean }> {
  const repo = getRunsRepo();

  // Build filter object
  const filter: Filter<CronRunRow> = {};
  if (options?.name) {
    filter.cronName = options.name;
  }
  if (options?.session) {
    filter.session = options.session;
  }
  if (options?.since) {
    filter.startedAt = { $gte: options.since };
  }
  if (options?.successOnly) {
    filter.status = "success";
  } else if (options?.failedOnly) {
    filter.status = "failure";
  }

  // Get total count
  const total = await repo.count(filter);

  // Build query with filter, order, and pagination (chain all calls)
  const offset = options?.offset ?? 0;
  const limit = options?.limit ?? 50;
  const entries = await repo.query().where(filter).orderBy("startedAt", "desc").offset(offset).limit(limit).execute();

  const hasMore = offset + entries.length < total;

  return { entries, total, hasMore };
}

/**
 * Clear cron run history with optional filtering
 */
export async function clearCronHistory(options?: { name?: string; session?: string }): Promise<number> {
  const repo = getRunsRepo();

  if (options?.name) {
    return await repo.deleteMany({ cronName: options.name });
  }
  if (options?.session) {
    return await repo.deleteMany({ session: options.session });
  }
  // Clear all
  return await repo.deleteMany({});
}

/**
 * Reset repository references (called during plugin shutdown)
 */
export function resetCronStorage(): void {
  jobsRepo = null;
  runsRepo = null;
}
