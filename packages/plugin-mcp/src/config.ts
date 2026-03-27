import { z } from "zod";

const StdioServerSchema = z.object({
  name: z.string().min(1),
  kind: z.literal("stdio"),
  cmd: z.string().min(1),
  args: z.array(z.string()).optional().default([]),
  env: z.record(z.string()).optional(),
});

const SseServerSchema = z.object({
  name: z.string().min(1),
  kind: z.literal("sse"),
  url: z.string().url(),
  headers: z.record(z.string()).optional(),
});

const HttpServerSchema = z.object({
  name: z.string().min(1),
  kind: z.literal("http"),
  url: z.string().url(),
  headers: z.record(z.string()).optional(),
});

const ServerConfigSchema = z.discriminatedUnion("kind", [StdioServerSchema, SseServerSchema, HttpServerSchema]);

export const PluginConfigSchema = z.object({
  servers: z.array(ServerConfigSchema).default([]),
});

export type ServerConfig = z.infer<typeof ServerConfigSchema>;
export type StdioServerConfig = z.infer<typeof StdioServerSchema>;
export type SseServerConfig = z.infer<typeof SseServerSchema>;
export type HttpServerConfig = z.infer<typeof HttpServerSchema>;
export type PluginConfig = z.infer<typeof PluginConfigSchema>;
