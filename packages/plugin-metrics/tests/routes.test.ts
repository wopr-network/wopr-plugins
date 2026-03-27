import { beforeEach, describe, expect, it } from "vitest";
import { MetricsStore } from "../src/metrics-store.js";
import { createMetricsRouter } from "../src/routes.js";
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

      return [];
    },
  } as unknown as StorageApi;
}

describe("createMetricsRouter", () => {
  let store: MetricsStore;

  beforeEach(async () => {
    store = await MetricsStore.create(createMockStorage());
  });

  it("GET /metrics returns platform summary", async () => {
    await store.record("messages_processed", 10, "inst-1");
    await store.record("tokens_consumed", 500, "inst-1");

    const router = createMetricsRouter(store);
    const res = await router.request("/metrics");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toHaveProperty("total_instances");
    expect(body).toHaveProperty("total_messages_processed");
    expect(body.total_messages_processed).toBe(10);
  });

  it("GET /instances/:id/metrics returns instance summary", async () => {
    await store.record("messages_processed", 42, "inst-abc");

    const router = createMetricsRouter(store);
    const res = await router.request("/instances/inst-abc/metrics");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.instance_id).toBe("inst-abc");
    expect(body.messages_processed).toBe(42);
  });

  it("POST /metrics records a metric and returns 201", async () => {
    const router = createMetricsRouter(store);
    const res = await router.request("/metrics", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "error_count", value: 3, instance_id: "inst-1" }),
    });
    expect(res.status).toBe(201);

    const body = await res.json();
    expect(body.recorded).toBe(true);
  });

  it("POST /metrics without name returns 400", async () => {
    const router = createMetricsRouter(store);
    const res = await router.request("/metrics", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: 5 }),
    });
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error).toBe("name and value are required");
  });

  it("POST /metrics without value returns 400", async () => {
    const router = createMetricsRouter(store);
    const res = await router.request("/metrics", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "my_metric" }),
    });
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error).toBe("name and value are required");
  });
});
