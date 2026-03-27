import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import type { MetricsStore } from "./metrics-store.js";

/**
 * Create the metrics observability router.
 * Accepts a MetricsStore instance (created during plugin init).
 */
export function createMetricsRouter(store: MetricsStore): Hono {
  const router = new Hono();

  // GET /metrics — platform-wide metrics summary
  router.get(
    "/metrics",
    describeRoute({
      tags: ["Observability"],
      summary: "Platform-wide metrics summary",
      responses: {
        200: { description: "Aggregated platform metrics" },
        401: { description: "Unauthorized" },
      },
    }),
    async (c) => {
      const summary = await store.getPlatformSummary();
      return c.json(summary);
    },
  );

  // GET /instances/:id/metrics — per-instance metrics
  router.get(
    "/instances/:id/metrics",
    describeRoute({
      tags: ["Observability"],
      summary: "Per-instance metrics summary",
      responses: {
        200: { description: "Instance metrics" },
        401: { description: "Unauthorized" },
      },
    }),
    async (c) => {
      const instanceId = c.req.param("id");
      const summary = await store.getInstanceSummary(instanceId);
      return c.json(summary);
    },
  );

  // POST /metrics — record a metric data point
  router.post(
    "/metrics",
    describeRoute({
      tags: ["Observability"],
      summary: "Record a metric data point",
      responses: {
        201: { description: "Metric recorded" },
        400: { description: "name and value are required" },
        401: { description: "Unauthorized" },
      },
    }),
    async (c) => {
      let body: { name?: unknown; value?: unknown; instance_id?: unknown; tags?: unknown };
      try {
        body = await c.req.json();
      } catch {
        return c.json({ error: "Invalid JSON body" }, 400);
      }
      const { name, value, instance_id, tags } = body;

      if (!name || value == null) {
        return c.json({ error: "name and value are required" }, 400);
      }

      await store.record(
        name as string,
        value as number,
        (instance_id as string | null) ?? null,
        (tags as Record<string, string>) ?? {},
      );
      return c.json({ recorded: true }, 201);
    },
  );

  return router;
}
