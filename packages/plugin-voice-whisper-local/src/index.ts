/**
 * WOPR Voice Plugin: Whisper Local (faster-whisper Docker)
 *
 * Provides local STT using faster-whisper server running in Docker.
 * Automatically pulls and manages the Docker container.
 */

import type { PluginManifest, WOPRPlugin, WOPRPluginContext } from "@wopr-network/plugin-types";
import { WhisperLocalProvider } from "./provider.js";
import type { WhisperLocalConfig } from "./types.js";
import { configSchema } from "./types.js";

// =============================================================================
// Module-level state
// =============================================================================

let ctx: WOPRPluginContext | null = null;
const cleanups: Array<() => unknown> = [];

// =============================================================================
// Manifest
// =============================================================================

const manifest: PluginManifest = {
  name: "wopr-plugin-voice-whisper-local",
  version: "1.0.0",
  description: "Local STT using faster-whisper in Docker",
  capabilities: ["stt"],
  category: "voice",
  tags: ["stt", "whisper", "local", "docker", "voice", "speech-to-text"],
  icon: "\uD83C\uDFA4",
  requires: {
    docker: ["fedirz/faster-whisper-server:latest"],
  },
  provides: {
    capabilities: [
      {
        type: "stt",
        id: "whisper-local",
        displayName: "Whisper Local (faster-whisper)",
        tier: "wopr",
        configSchema,
      },
    ],
  },
  lifecycle: {
    shutdownBehavior: "graceful",
    shutdownTimeoutMs: 15000,
  },
  configSchema,
  install: [
    {
      kind: "docker",
      image: "fedirz/faster-whisper-server",
      tag: "latest-cpu",
      label: "Pull faster-whisper server image",
    },
  ],
};

// =============================================================================
// Plugin Definition
// =============================================================================

const plugin: WOPRPlugin = {
  name: "voice-whisper-local",
  version: "1.0.0",
  description: "Local STT using faster-whisper in Docker",
  manifest,

  async init(context: WOPRPluginContext) {
    ctx = context;

    // Register config schema
    ctx.registerConfigSchema("voice-whisper-local", configSchema);
    cleanups.push(() => ctx?.unregisterConfigSchema("voice-whisper-local"));

    // Create and validate provider
    const config = ctx.getConfig<WhisperLocalConfig>();
    const provider = new WhisperLocalProvider(config);
    provider.validateConfig();

    // Register STT provider
    ctx.registerSTTProvider(provider);
    cleanups.push(() => provider.shutdown());

    ctx.log.info("Whisper Local STT provider registered");
  },

  async shutdown() {
    // Run cleanups in LIFO order
    for (let i = cleanups.length - 1; i >= 0; i--) {
      try {
        await cleanups[i]();
      } catch {
        // Ignore cleanup errors during shutdown
      }
    }
    cleanups.length = 0;
    ctx = null;
  },
};

export default plugin;
