import { beforeEach, describe, expect, it } from "vitest";
import { createMetricsA2AServer } from "../src/a2a-tools.js";
import { MetricsStore } from "../src/metrics-store.js";
import type { PluginSchema, StorageApi } from "../src/types.js";

function createMockStorage(): StorageApi {
  const rows: Record<string, unknown>[] = [];

  return {
    register: async (_schema: PluginSchema) => {},

    raw: async (sql: string, params: unknown[]) => {
      if (sql.includes("INSERT INTO metrics_rows")) {
        const [id, timestamp, metric_name, metric_value, instance_id, tags] = params;
        rows.push({ id, timestamp, metric_name, metric_value, instance_id, tags });
        return [];
      }

      if (sql.includes("COALESCE(SUM(metric_value)")) {
        const paramsCopy = [...params];
        const name = paramsCopy.shift() as string;
        let filtered = rows.filter((r) => r.metric_name === name);
        if (sql.includes("AND instance_id = ?")) {
          const instId = paramsCopy.shift() as string;
          filtered = filtered.filter((r) => r.instance_id === instId);
        }
        const total = filtered.reduce((sum, r) => sum + (r.metric_value as number), 0);
        return [{ total }];
      }

      if (sql.includes("COUNT(DISTINCT instance_id)")) {
        const instanceIds = new Set(
          rows.filter((r) => r.instance_id !== null && r.instance_id !== undefined).map((r) => r.instance_id),
        );
        return [{ count: instanceIds.size }];
      }

      if (sql.includes("SELECT metric_value FROM metrics_rows WHERE metric_name = ?")) {
        const name = params[0] as string;
        const instanceId = params[1] as string | undefined;
        let filtered = rows.filter((r) => r.metric_name === name);
        if (instanceId !== undefined) {
          filtered = filtered.filter((r) => r.instance_id === instanceId);
        } else {
          filtered = filtered.filter((r) => r.instance_id === null || r.instance_id === undefined);
        }
        filtered.sort((a, b) => (b.timestamp as number) - (a.timestamp as number));
        if (filtered.length === 0) return [];
        return [{ metric_value: filtered[0].metric_value }];
      }

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

describe("createMetricsA2AServer", () => {
  let store: MetricsStore;

  beforeEach(async () => {
    store = await MetricsStore.create(createMockStorage());
  });

  it("metrics.record handler records a metric", async () => {
    const server = createMetricsA2AServer(store);
    const recordTool = server.tools.find((t) => t.name === "metrics.record");
    expect(recordTool).toBeDefined();

    const result = await recordTool!.handler({ name: "messages_processed", value: 10, instance_id: "inst-1" });
    expect(result.content[0].text).toContain("messages_processed=10");
    expect(result.isError).toBeUndefined();

    // Verify the metric was actually recorded
    const latest = await store.getLatest("messages_processed", "inst-1");
    expect(latest).toBe(10);
  });

  it("metrics.query handler returns filtered results", async () => {
    await store.record("messages_processed", 5, "inst-1");
    await store.record("tokens_consumed", 100, "inst-1");
    await store.record("messages_processed", 7, "inst-2");

    const server = createMetricsA2AServer(store);
    const queryTool = server.tools.find((t) => t.name === "metrics.query");
    expect(queryTool).toBeDefined();

    const result = await queryTool!.handler({ name: "messages_processed" });
    const parsed = JSON.parse(result.content[0].text as string);
    expect(parsed).toHaveLength(2);
  });

  it("metrics.summary handler returns platform summary", async () => {
    await store.record("messages_processed", 10, "inst-1");
    await store.record("messages_processed", 20, "inst-2");

    const server = createMetricsA2AServer(store);
    const summaryTool = server.tools.find((t) => t.name === "metrics.summary");
    expect(summaryTool).toBeDefined();

    const result = await summaryTool!.handler({});
    const parsed = JSON.parse(result.content[0].text as string);
    expect(parsed.total_instances).toBe(2);
    expect(parsed.total_messages_processed).toBe(30);
  });

  it("metrics.summary handler with instance_id returns instance summary", async () => {
    await store.record("messages_processed", 42, "inst-xyz");
    await store.record("tokens_consumed", 200, "inst-xyz");

    const server = createMetricsA2AServer(store);
    const summaryTool = server.tools.find((t) => t.name === "metrics.summary");
    expect(summaryTool).toBeDefined();

    const result = await summaryTool!.handler({ instance_id: "inst-xyz" });
    const parsed = JSON.parse(result.content[0].text as string);
    expect(parsed.instance_id).toBe("inst-xyz");
    expect(parsed.messages_processed).toBe(42);
    expect(parsed.tokens_consumed).toBe(200);
  });

  it("server has correct name and version", () => {
    const server = createMetricsA2AServer(store);
    expect(server.name).toBe("metrics");
    expect(server.version).toBe("1.0.0");
    expect(server.tools).toHaveLength(3);
  });
});
