import { beforeEach, describe, expect, it } from "vitest";
import { MetricsStore } from "../src/metrics-store.js";
import type { PluginSchema, StorageApi } from "../src/types.js";

/**
 * In-memory StorageApi mock for testing.
 * Simulates SQLite behavior using in-memory arrays and raw() for all operations.
 */
function createMockStorage(): StorageApi {
  const rows: Record<string, unknown>[] = [];

  return {
    register: async (_schema: PluginSchema) => {},

    raw: async (sql: string, params: unknown[]) => {
      // Handle INSERT statements
      if (sql.includes("INSERT INTO metrics_rows")) {
        const [id, timestamp, metric_name, metric_value, instance_id, tags] = params;
        rows.push({ id, timestamp, metric_name, metric_value, instance_id, tags });
        return [];
      }

      // Handle SELECT metric_value (getLatest)
      if (sql.includes("SELECT metric_value FROM metrics_rows WHERE metric_name = ?")) {
        const name = params[0] as string;
        const instanceId = params[1] as string | undefined;

        let filtered = rows.filter((r) => r.metric_name === name);
        if (instanceId !== undefined) {
          filtered = filtered.filter((r) => r.instance_id === instanceId);
        } else {
          // instance_id IS NULL
          filtered = filtered.filter((r) => r.instance_id === null || r.instance_id === undefined);
        }
        filtered.sort((a, b) => (b.timestamp as number) - (a.timestamp as number));
        if (filtered.length === 0) return [];
        return [{ metric_value: filtered[0].metric_value }];
      }

      // Handle SUM queries (getSum)
      if (sql.includes("COALESCE(SUM(metric_value)")) {
        const paramsCopy = [...params];
        const name = paramsCopy.shift() as string;
        let filtered = rows.filter((r) => r.metric_name === name);

        if (sql.includes("AND instance_id = ?")) {
          const instId = paramsCopy.shift() as string;
          filtered = filtered.filter((r) => r.instance_id === instId);
        }

        if (sql.includes("AND timestamp >= ?")) {
          const since = paramsCopy.shift() as number;
          filtered = filtered.filter((r) => (r.timestamp as number) >= since);
        }

        const total = filtered.reduce((sum, r) => sum + (r.metric_value as number), 0);
        return [{ total }];
      }

      // Handle COUNT DISTINCT (getDistinctInstanceCount)
      if (sql.includes("COUNT(DISTINCT instance_id)")) {
        const instanceIds = new Set(
          rows
            .filter((r) => r.instance_id !== null && r.instance_id !== undefined)
            .map((r) => r.instance_id),
        );
        return [{ count: instanceIds.size }];
      }

      // Handle full SELECT (query)
      if (sql.includes("SELECT id, timestamp, metric_name, metric_value, instance_id, tags FROM metrics_rows")) {
        let filtered = [...rows];
        const paramsCopy = [...params];

        if (sql.includes("AND metric_name = ?")) {
          const name = paramsCopy.shift() as string;
          filtered = filtered.filter((r) => r.metric_name === name);
        }

        if (sql.includes("AND instance_id = ?")) {
          const instId = paramsCopy.shift() as string;
          filtered = filtered.filter((r) => r.instance_id === instId);
        }

        if (sql.includes("AND timestamp >= ?")) {
          const since = paramsCopy.shift() as number;
          filtered = filtered.filter((r) => (r.timestamp as number) >= since);
        }

        filtered.sort((a, b) => (b.timestamp as number) - (a.timestamp as number));

        if (sql.includes("LIMIT ?")) {
          const limit = paramsCopy.shift() as number;
          filtered = filtered.slice(0, limit);
        }

        return filtered;
      }

      return [];
    },
  } as unknown as StorageApi;
}

describe("MetricsStore", () => {
  let store: MetricsStore;

  beforeEach(async () => {
    const storage = createMockStorage();
    store = await MetricsStore.create(storage);
  });

  it("records and retrieves a metric", async () => {
    await store.record("messages_processed", 5, "inst-1");

    const latest = await store.getLatest("messages_processed", "inst-1");
    expect(latest).toBe(5);
  });

  it("returns null for non-existent metric", async () => {
    const latest = await store.getLatest("nonexistent", "inst-1");
    expect(latest).toBeNull();
  });

  it("gets latest value (most recent)", async () => {
    await store.record("active_sessions", 2, "inst-1");
    await new Promise((resolve) => setTimeout(resolve, 2));
    await store.record("active_sessions", 5, "inst-1");
    await new Promise((resolve) => setTimeout(resolve, 2));
    await store.record("active_sessions", 3, "inst-1");

    const latest = await store.getLatest("active_sessions", "inst-1");
    expect(latest).toBe(3);
  });

  it("computes sum of a metric for an instance", async () => {
    await store.record("messages_processed", 10, "inst-1");
    await store.record("messages_processed", 20, "inst-1");
    await store.record("messages_processed", 5, "inst-2");

    const sum = await store.getSum("messages_processed", "inst-1");
    expect(sum).toBe(30);
  });

  it("computes sum across all instances", async () => {
    await store.record("messages_processed", 10, "inst-1");
    await store.record("messages_processed", 20, "inst-2");

    const sum = await store.getSum("messages_processed");
    expect(sum).toBe(30);
  });

  it("returns 0 for sum of non-existent metric", async () => {
    const sum = await store.getSum("nonexistent");
    expect(sum).toBe(0);
  });

  it("counts distinct instances", async () => {
    await store.record("messages_processed", 1, "inst-1");
    await store.record("messages_processed", 2, "inst-2");
    await store.record("tokens_consumed", 100, "inst-1");

    expect(await store.getDistinctInstanceCount()).toBe(2);
  });

  it("returns instance summary", async () => {
    await store.record("messages_processed", 10, "inst-1");
    await store.record("tokens_consumed", 500, "inst-1");
    await store.record("active_sessions", 3, "inst-1");
    await store.record("uptime_seconds", 120, "inst-1");
    await store.record("error_count", 2, "inst-1");

    const summary = await store.getInstanceSummary("inst-1");
    expect(summary.instance_id).toBe("inst-1");
    expect(summary.messages_processed).toBe(10);
    expect(summary.tokens_consumed).toBe(500);
    expect(summary.active_sessions).toBe(3);
    expect(summary.uptime_seconds).toBe(120);
    expect(summary.error_count).toBe(2);
  });

  it("returns platform summary", async () => {
    await store.record("messages_processed", 10, "inst-1");
    await store.record("messages_processed", 20, "inst-2");
    await store.record("tokens_consumed", 100, "inst-1");
    await store.record("error_count", 1, "inst-1");

    const summary = await store.getPlatformSummary();
    expect(summary.total_instances).toBe(2);
    expect(summary.total_messages_processed).toBe(30);
    expect(summary.total_tokens_consumed).toBe(100);
    expect(summary.total_errors).toBe(1);
  });

  it("queries metrics with filters", async () => {
    await store.record("messages_processed", 10, "inst-1");
    await store.record("tokens_consumed", 100, "inst-1");
    await store.record("messages_processed", 20, "inst-2");

    const results = await store.query({ name: "messages_processed" });
    expect(results).toHaveLength(2);

    const inst1Results = await store.query({ name: "messages_processed", instanceId: "inst-1" });
    expect(inst1Results).toHaveLength(1);
    expect(inst1Results[0].metric_value).toBe(10);
  });

  it("queries metrics with limit", async () => {
    for (let i = 0; i < 10; i++) {
      await store.record("messages_processed", i, "inst-1");
    }

    const results = await store.query({ name: "messages_processed", limit: 3 });
    expect(results).toHaveLength(3);
  });

  it("records metric with tags", async () => {
    await store.record("api_calls", 1, "inst-1", { provider: "openai", model: "gpt-4" });

    const results = await store.query({ name: "api_calls" });
    expect(results).toHaveLength(1);
    expect(JSON.parse(results[0].tags as string)).toEqual({ provider: "openai", model: "gpt-4" });
  });

  it("records platform-wide metric with null instance_id", async () => {
    await store.record("total_active_users", 42);

    const latest = await store.getLatest("total_active_users");
    expect(latest).toBe(42);
  });
});
