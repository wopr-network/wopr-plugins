/**
 * WOPR Sandbox Plugin
 *
 * Docker-based session isolation for untrusted sessions.
 * Manages container lifecycle, per-session context, and tool policy.
 */

import type { WOPRPlugin, WOPRPluginContext } from "@wopr-network/plugin-types";
import { pruneAllSandboxes } from "./prune.js";
import { setRuntime } from "./runtime.js";
import { migrateSandboxRegistryToSql } from "./sandbox-migrate.js";
import { initSandboxStorage } from "./sandbox-repository.js";

// Re-export public API for consumers
export {
  resolveSandboxConfig,
  resolveSandboxDockerConfig,
  resolveSandboxPruneConfig,
  resolveSandboxScope,
  shouldSandbox,
} from "./config.js";
export { computeSandboxConfigHash } from "./config-hash.js";
export {
  DEFAULT_SANDBOX_CONTAINER_PREFIX,
  DEFAULT_SANDBOX_IDLE_HOURS,
  DEFAULT_SANDBOX_IMAGE,
  DEFAULT_SANDBOX_MAX_AGE_DAYS,
  DEFAULT_SANDBOX_WORKDIR,
  DEFAULT_SANDBOX_WORKSPACE_ROOT,
  DEFAULT_TOOL_ALLOW,
  DEFAULT_TOOL_DENY,
  SANDBOX_REGISTRY_PATH,
  SANDBOX_STATE_DIR,
} from "./constants.js";
export { ensureSandboxWorkspace, getSandboxWorkspaceInfo, resolveSandboxContext } from "./context.js";
export {
  buildSandboxCreateArgs,
  dockerContainerState,
  ensureDockerImage,
  ensureSandboxContainer,
  execDocker,
  execInContainer,
  execInContainerRaw,
  removeSandboxContainer,
} from "./docker.js";
export { ensureDockerContainerIsRunning, maybePruneSandboxes, pruneAllSandboxes } from "./prune.js";
export type { SandboxRegistryEntry } from "./registry.js";
export { findRegistryEntry, listRegistryEntries, removeRegistryEntry, updateRegistry } from "./registry.js";
export { resolveSandboxScopeKey, resolveSandboxWorkspaceDir, slugifySessionKey } from "./shared.js";
export { shellEscapeArg, validateCommand } from "./shell-escape.js";
export { filterToolsByPolicy, isToolAllowed, resolveSandboxToolPolicy } from "./tool-policy.js";
export type {
  SandboxConfig,
  SandboxContext,
  SandboxDockerConfig,
  SandboxPruneConfig,
  SandboxScope,
  SandboxToolPolicy,
  SandboxToolPolicyResolved,
  SandboxWorkspaceAccess,
  SandboxWorkspaceInfo,
} from "./types.js";

// Module-level state
let ctx: WOPRPluginContext | null = null;
const cleanups: Array<() => void> = [];

const plugin: WOPRPlugin = {
  name: "wopr-plugin-sandbox",
  version: "1.0.0",
  description: "Docker-based session isolation — container lifecycle, per-session context, tool policy engine",

  manifest: {
    name: "wopr-plugin-sandbox",
    version: "1.0.0",
    description: "Docker-based session isolation — container lifecycle, per-session context, tool policy engine",
    capabilities: ["sandbox", "container-isolation", "tool-policy"],
    category: "infrastructure",
    tags: ["docker", "sandbox", "isolation", "security"],
    icon: "shield",
    requires: {
      bins: ["docker"],
    },
    lifecycle: {
      shutdownBehavior: "graceful",
    },
  },

  async init(pluginCtx: WOPRPluginContext) {
    ctx = pluginCtx;

    // Wire runtime dependencies from plugin context
    setRuntime({
      logger: ctx.log,
      storage: ctx.storage,
      getMainConfig: (key?: string) => pluginCtx.getMainConfig(key),
    });

    // Initialize SQL storage schema
    await initSandboxStorage();

    // Run JSON-to-SQL migration if needed
    await migrateSandboxRegistryToSql();

    // Register sandbox API as a plugin extension so other plugins/core can access it
    ctx.registerExtension("sandbox", {
      resolveSandboxContext: (await import("./context.js")).resolveSandboxContext,
      getSandboxWorkspaceInfo: (await import("./context.js")).getSandboxWorkspaceInfo,
      execInContainer: (await import("./docker.js")).execInContainer,
      execInContainerRaw: (await import("./docker.js")).execInContainerRaw,
      execDocker: (await import("./docker.js")).execDocker,
      shouldSandbox: (await import("./config.js")).shouldSandbox,
      resolveSandboxConfig: (await import("./config.js")).resolveSandboxConfig,
      isToolAllowed: (await import("./tool-policy.js")).isToolAllowed,
      filterToolsByPolicy: (await import("./tool-policy.js")).filterToolsByPolicy,
      pruneAllSandboxes: (await import("./prune.js")).pruneAllSandboxes,
    });
    cleanups.push(() => ctx?.unregisterExtension("sandbox"));

    ctx.log.info("Sandbox plugin initialized");
  },

  async shutdown() {
    // Reverse all registrations
    for (const cleanup of cleanups.splice(0)) {
      try {
        cleanup();
      } catch {
        // best effort
      }
    }

    // Clean up all sandbox containers on shutdown
    if (ctx) {
      try {
        await pruneAllSandboxes();
      } catch {
        // Best effort cleanup
      }
    }

    ctx = null;
  },
};

export default plugin;
