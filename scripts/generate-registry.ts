import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

interface PluginRegistryEntry {
  name: string;
  version: string;
  description: string;
  category: string;
  tags: string[];
  capabilities: string[];
  requires: Record<string, unknown>;
  provides: string[];
  maturity: string;
  path: string;
  setupFlow?: string;
  icon?: string;
}

interface PluginRegistry {
  version: string;
  generated: string;
  count: number;
  plugins: PluginRegistryEntry[];
}

const ROOT = resolve(import.meta.dirname, "..");
const PACKAGES_DIR = join(ROOT, "packages");

function inferCategory(pkg: Record<string, unknown>): string {
  const name = (pkg.name as string) || "";
  const wopr = pkg.wopr as Record<string, unknown> | undefined;
  if (wopr?.plugin) {
    const plugin = wopr.plugin as Record<string, unknown>;
    if (plugin.category) return plugin.category as string;
  }
  if (name.includes("voice-") || name.includes("whisper")) return "voice";
  if (name.includes("provider-")) return "provider";
  if (name.includes("memory-")) return "memory";
  if (name.includes("channel-")) return "channel";
  const channelPlugins = [
    "discord", "slack", "telegram", "msteams", "whatsapp", "irc", "matrix",
    "signal", "line", "feishu", "googlechat", "bluebubbles", "imessage",
    "reddit", "twitter", "nostr", "twitch", "mastodon",
  ];
  const shortName = name.replace("@wopr-network/wopr-plugin-", "");
  if (channelPlugins.includes(shortName)) return "channel";
  if (["browser", "exec", "http", "cron", "tools", "webhooks"].includes(shortName)) return "utility";
  if (["imagegen", "videogen", "canvas"].includes(shortName)) return "media";
  if (["mcp", "a2a", "p2p"].includes(shortName)) return "integration";
  if (["webui", "router", "setup"].includes(shortName)) return "system";
  return "plugin";
}

function extractEntry(dir: string): PluginRegistryEntry | null {
  const pkgPath = join(dir, "package.json");
  if (!existsSync(pkgPath)) return null;
  const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
  if (pkg.name === "@wopr-network/plugin-types") return null;

  const wopr = (pkg.wopr?.plugin || {}) as Record<string, unknown>;

  return {
    name: pkg.name,
    version: pkg.version,
    description: pkg.description || "",
    category: inferCategory(pkg),
    tags: (wopr.tags as string[]) || (pkg.keywords as string[]) || [],
    capabilities: (wopr.capabilities as string[]) || [],
    requires: (wopr.requires as Record<string, unknown>) || {},
    provides: (wopr.provides as string[]) || [],
    maturity: (wopr.maturity as string) || (pkg.version?.startsWith("0.") ? "experimental" : "stable"),
    path: `packages/${dir.split("/").pop()}`,
    ...(wopr.setupFlow ? { setupFlow: wopr.setupFlow as string } : {}),
    ...(wopr.icon ? { icon: wopr.icon as string } : {}),
  };
}

const checkMode = process.argv.includes("--check");
const dirs = readdirSync(PACKAGES_DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => join(PACKAGES_DIR, d.name))
  .sort();

const plugins = dirs.map(extractEntry).filter(Boolean) as PluginRegistryEntry[];
plugins.sort((a, b) => a.name.localeCompare(b.name));

const registry: PluginRegistry = {
  version: "1.0.0",
  generated: new Date().toISOString(),
  count: plugins.length,
  plugins,
};

const output = JSON.stringify(registry, null, 2) + "\n";
const registryPath = join(ROOT, "plugin-registry.json");

if (checkMode) {
  if (!existsSync(registryPath)) {
    console.error("plugin-registry.json does not exist. Run: pnpm run generate-registry");
    process.exit(1);
  }
  const existing = readFileSync(registryPath, "utf-8");
  const existingParsed = JSON.parse(existing);
  // Compare without generated timestamp
  existingParsed.generated = registry.generated;
  if (JSON.stringify(existingParsed) !== JSON.stringify(registry)) {
    console.error("plugin-registry.json is out of date. Run: pnpm run generate-registry");
    process.exit(1);
  }
  console.log("plugin-registry.json is up to date.");
} else {
  writeFileSync(registryPath, output);
  console.log(`Generated plugin-registry.json with ${plugins.length} plugins.`);
}
