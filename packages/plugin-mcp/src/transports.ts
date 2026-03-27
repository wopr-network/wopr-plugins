import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { ServerConfig } from "./config.js";

// Env vars that can alter dynamic linker, module resolution, or interpreter behaviour —
// stripping these prevents a user-supplied env map from hijacking the spawned subprocess.
const DANGEROUS_ENV_KEYS = new Set([
  "LD_PRELOAD",
  "LD_LIBRARY_PATH",
  "DYLD_INSERT_LIBRARIES",
  "DYLD_LIBRARY_PATH",
  "NODE_OPTIONS",
  "NODE_PATH",
  "PATH",
]);

function sanitizeEnv(env: Record<string, string> | undefined): Record<string, string> | undefined {
  if (!env) return undefined;
  return Object.fromEntries(Object.entries(env).filter(([key]) => !DANGEROUS_ENV_KEYS.has(key)));
}

export function createTransport(config: ServerConfig): Transport {
  switch (config.kind) {
    case "stdio":
      return new StdioClientTransport({
        command: config.cmd,
        args: config.args,
        env: sanitizeEnv(config.env),
      });
    case "sse":
      return new SSEClientTransport(new URL(config.url), {
        requestInit: config.headers ? { headers: config.headers } : undefined,
      });
    case "http":
      return new StreamableHTTPClientTransport(new URL(config.url), {
        requestInit: config.headers ? { headers: config.headers } : undefined,
      });
    default: {
      const exhaustive: never = config;
      throw new Error(`Unhandled ServerConfig kind: ${(exhaustive as { kind: string }).kind}`);
    }
  }
}
