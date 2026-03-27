/**
 * Web Search A2A tool: web_search
 *
 * Multi-provider web search with fallback chain, rate limiting, and SSRF protection.
 */

import { isIP } from "node:net";
import type { A2AServerConfig, A2AToolResult } from "@wopr-network/plugin-types";
import {
  BraveSearchProvider,
  GoogleSearchProvider,
  type WebSearchProvider,
  type WebSearchResult,
  XaiSearchProvider,
} from "./providers/index.js";

// ---------------------------------------------------------------------------
// Plugin config interface
// ---------------------------------------------------------------------------

export interface WebSearchPluginConfig {
  providerOrder?: ProviderName[];
  providers?: {
    google?: { apiKey?: string; cx?: string };
    brave?: { apiKey?: string };
    xai?: { apiKey?: string };
  };
}

// ---------------------------------------------------------------------------
// SSRF protection — block private/internal IP ranges in result URLs
// ---------------------------------------------------------------------------

const PRIVATE_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "::1",
  "0.0.0.0",
  "metadata.google.internal",
  "169.254.169.254",
]);

const PRIVATE_CIDR_PREFIXES = [
  "10.",
  "127.",
  "169.254.",
  "172.16.",
  "172.17.",
  "172.18.",
  "172.19.",
  "172.20.",
  "172.21.",
  "172.22.",
  "172.23.",
  "172.24.",
  "172.25.",
  "172.26.",
  "172.27.",
  "172.28.",
  "172.29.",
  "172.30.",
  "172.31.",
  "192.168.",
  "0.",
  "100.64.",
  "198.18.",
  "198.19.",
];

/**
 * Extract the IPv4 octets from an IPv6-mapped IPv4 address.
 * URL.hostname normalises `::ffff:A.B.C.D` to `[::ffff:XXYY:ZZWW]` (hex pairs).
 * Returns the IPv4 dotted-quad string, or null if not a mapped address.
 */
function extractMappedIPv4(hostname: string): string | null {
  const bare = hostname.startsWith("[") ? hostname.slice(1, -1) : hostname;
  const match = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(bare);
  if (match) {
    const hi = parseInt(match[1], 16);
    const lo = parseInt(match[2], 16);
    return `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
  }
  const dottedMatch = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(bare);
  if (dottedMatch) {
    return dottedMatch[1];
  }
  return null;
}

/**
 * Detect numeric IP encodings (decimal, octal, hex) that resolve to private addresses.
 */
function isNumericPrivateIp(hostname: string): boolean {
  if (/^\d+$/.test(hostname)) {
    const num = Number(hostname);
    if (num >= 0 && num <= 0xffffffff) {
      const a = (num >>> 24) & 0xff;
      const b = (num >>> 16) & 0xff;
      if (a === 127) return true;
      if (a === 10) return true;
      if (a === 172 && b >= 16 && b <= 31) return true;
      if (a === 192 && b === 168) return true;
      if (a === 169 && b === 254) return true;
      if (a === 0) return true;
      if (a === 100 && b === 64) return true;
      if (a === 198 && (b === 18 || b === 19)) return true;
    }
  }
  if (/^0x[0-9a-f]+$/i.test(hostname)) {
    const num = Number(hostname);
    if (!Number.isNaN(num) && num >= 0 && num <= 0xffffffff) {
      const a = (num >>> 24) & 0xff;
      const b = (num >>> 16) & 0xff;
      if (a === 127) return true;
      if (a === 10) return true;
      if (a === 172 && b >= 16 && b <= 31) return true;
      if (a === 192 && b === 168) return true;
      if (a === 169 && b === 254) return true;
      if (a === 0) return true;
    }
  }
  return false;
}

function isPrivateIPv6(bare: string): boolean {
  const lower = bare.toLowerCase();
  if (lower === "::1") return true;
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true;
  if (lower.startsWith("fe80")) return true;
  return false;
}

export function isPrivateUrl(urlStr: string): boolean {
  try {
    const parsed = new URL(urlStr);
    const hostname = parsed.hostname.toLowerCase();

    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return true;

    const bare = hostname.startsWith("[") ? hostname.slice(1, -1) : hostname;

    if (PRIVATE_HOSTS.has(hostname) || PRIVATE_HOSTS.has(bare)) return true;

    const ipVersion = isIP(bare);

    if (ipVersion === 4) {
      if (PRIVATE_CIDR_PREFIXES.some((prefix) => bare.startsWith(prefix))) return true;
    } else if (ipVersion === 6) {
      if (isPrivateIPv6(bare)) return true;
    }

    const mappedIpv4 = extractMappedIPv4(hostname);
    if (mappedIpv4) {
      if (PRIVATE_HOSTS.has(mappedIpv4)) return true;
      if (PRIVATE_CIDR_PREFIXES.some((prefix) => mappedIpv4.startsWith(prefix))) return true;
    }

    if (isNumericPrivateIp(hostname)) return true;

    return false;
  } catch {
    return true;
  }
}

function filterResults(results: WebSearchResult[]): WebSearchResult[] {
  return results.filter((r) => !isPrivateUrl(r.url));
}

// ---------------------------------------------------------------------------
// Per-provider rate limiter (token bucket)
// ---------------------------------------------------------------------------

interface RateBucket {
  tokens: number;
  lastRefill: number;
  maxTokens: number;
  refillRate: number;
}

const rateBuckets = new Map<string, RateBucket>();

function getRateBucket(provider: string): RateBucket {
  let bucket = rateBuckets.get(provider);
  if (!bucket) {
    bucket = { tokens: 10, lastRefill: Date.now(), maxTokens: 10, refillRate: 10 };
    rateBuckets.set(provider, bucket);
  }
  return bucket;
}

function consumeToken(provider: string): boolean {
  const bucket = getRateBucket(provider);
  const now = Date.now();
  const elapsed = (now - bucket.lastRefill) / 1000;
  bucket.tokens = Math.min(bucket.maxTokens, bucket.tokens + elapsed * bucket.refillRate);
  bucket.lastRefill = now;

  if (bucket.tokens < 1) return false;
  bucket.tokens -= 1;
  return true;
}

// ---------------------------------------------------------------------------
// Provider factory
// ---------------------------------------------------------------------------

type ProviderName = "google" | "brave" | "xai";

function buildProvider(name: ProviderName, config: WebSearchPluginConfig): WebSearchProvider | null {
  switch (name) {
    case "google": {
      const apiKey = process.env.GOOGLE_SEARCH_API_KEY ?? config.providers?.google?.apiKey;
      const cx = process.env.GOOGLE_SEARCH_CX ?? config.providers?.google?.cx;
      if (!apiKey || !cx) return null;
      return new GoogleSearchProvider({ apiKey, extra: { cx } });
    }
    case "brave": {
      const apiKey = process.env.BRAVE_SEARCH_API_KEY ?? config.providers?.brave?.apiKey;
      if (!apiKey) return null;
      return new BraveSearchProvider({ apiKey });
    }
    case "xai": {
      const apiKey = process.env.XAI_API_KEY ?? config.providers?.xai?.apiKey;
      if (!apiKey) return null;
      return new XaiSearchProvider({ apiKey });
    }
    default:
      return null;
  }
}

const DEFAULT_PROVIDER_ORDER: ProviderName[] = ["google", "brave", "xai"];

function getProviderOrder(config: WebSearchPluginConfig): ProviderName[] {
  const order = config.providerOrder;
  if (Array.isArray(order) && order.length > 0) {
    return order.filter((n): n is ProviderName => ["google", "brave", "xai"].includes(n));
  }
  return DEFAULT_PROVIDER_ORDER;
}

// ---------------------------------------------------------------------------
// Build A2A server config
// ---------------------------------------------------------------------------

export function buildWebSearchA2ATools(config: WebSearchPluginConfig): A2AServerConfig {
  return {
    name: "web-search",
    version: "1.0.0",
    tools: [
      {
        name: "web_search",
        description:
          "Search the web using configured providers (Google, Brave, xAI/Grok). Returns structured results with title, URL, and snippet. Providers are tried in order with automatic fallback.",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string", description: "Search query string" },
            count: { type: "number", description: "Number of results to return (default: 5, max: 20)" },
            provider: {
              type: "string",
              description: "Force a specific provider: google, brave, xai. Omit for auto fallback chain.",
            },
          },
          required: ["query"],
        },
        async handler(args: Record<string, unknown>): Promise<A2AToolResult> {
          const query = args.query as string;
          const rawCount = args.count as number | undefined;
          const forcedProvider = args.provider as string | undefined;

          const count = Math.max(1, Math.min(rawCount ?? 5, 20));
          const order: ProviderName[] = forcedProvider ? [forcedProvider as ProviderName] : getProviderOrder(config);

          const errors: string[] = [];

          for (const providerName of order) {
            const providerInstance = buildProvider(providerName, config);
            if (!providerInstance) {
              errors.push(`${providerName}: not configured`);
              continue;
            }

            if (!consumeToken(providerName)) {
              errors.push(`${providerName}: rate limited`);
              continue;
            }

            try {
              const raw = await providerInstance.search(query, count);
              const results = filterResults(raw);

              return {
                content: [
                  {
                    type: "text",
                    text: JSON.stringify(
                      {
                        provider: providerName,
                        query,
                        resultCount: results.length,
                        results,
                      },
                      null,
                      2,
                    ),
                  },
                ],
              };
            } catch (err: unknown) {
              const msg = err instanceof Error ? err.message : String(err);
              errors.push(`${providerName}: ${msg}`);
            }
          }

          return {
            content: [
              {
                type: "text",
                text: `All search providers failed:\n${errors.map((e) => `  - ${e}`).join("\n")}\n\nConfigure at least one provider via environment variables or config:\n  GOOGLE_SEARCH_API_KEY + GOOGLE_SEARCH_CX\n  BRAVE_SEARCH_API_KEY\n  XAI_API_KEY`,
              },
            ],
            isError: true,
          };
        },
      },
    ],
  };
}
