import type { A2AServerConfig, A2AToolResult } from "@wopr-network/plugin-types";
import type { MetricsStore } from "./metrics-store.js";

export function createMetricsA2AServer(store: MetricsStore): A2AServerConfig {
  return {
    name: "metrics",
    version: "1.0.0",
    tools: [
      {
        name: "metrics.record",
        description: "Record a metric data point",
        inputSchema: {
          type: "object",
          properties: {
            name: { type: "string", description: "Metric name (e.g., messages_processed)" },
            value: { type: "number", description: "Metric value" },
            instance_id: { type: "string", description: "Optional instance ID" },
            tags: {
              type: "object",
              additionalProperties: { type: "string" },
              description: "Optional key-value tags",
            },
          },
          required: ["name", "value"],
        },
        handler: async (args: Record<string, unknown>): Promise<A2AToolResult> => {
          if (typeof args.name !== "string" || args.name === "") {
            return { content: [{ type: "text", text: "Error: name must be a non-empty string" }], isError: true };
          }
          if (typeof args.value !== "number") {
            return { content: [{ type: "text", text: "Error: value must be a number" }], isError: true };
          }

          const name = args.name;
          const value = args.value;
          const instanceId = args.instance_id as string | undefined;
          const tags = (args.tags as Record<string, string>) ?? {};

          await store.record(name, value, instanceId, tags);
          return { content: [{ type: "text", text: `Recorded metric: ${name}=${value}` }] };
        },
      },
      {
        name: "metrics.query",
        description: "Query metrics with optional filters",
        inputSchema: {
          type: "object",
          properties: {
            name: { type: "string", description: "Filter by metric name" },
            instance_id: { type: "string", description: "Filter by instance ID" },
            since: { type: "number", description: "Timestamp (ms) to filter from" },
            limit: { type: "number", description: "Max results to return" },
          },
        },
        handler: async (args: Record<string, unknown>): Promise<A2AToolResult> => {
          const results = await store.query({
            name: args.name as string | undefined,
            instanceId: args.instance_id as string | undefined,
            since: args.since as number | undefined,
            limit: args.limit as number | undefined,
          });
          return {
            content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
          };
        },
      },
      {
        name: "metrics.summary",
        description: "Get platform-wide or per-instance metrics summary",
        inputSchema: {
          type: "object",
          properties: {
            instance_id: {
              type: "string",
              description: "Instance ID for per-instance summary. Omit for platform summary.",
            },
          },
        },
        handler: async (args: Record<string, unknown>): Promise<A2AToolResult> => {
          const instanceId = args.instance_id as string | undefined;
          const summary = instanceId ? await store.getInstanceSummary(instanceId) : await store.getPlatformSummary();
          return {
            content: [{ type: "text", text: JSON.stringify(summary, null, 2) }],
          };
        },
      },
    ],
  };
}
