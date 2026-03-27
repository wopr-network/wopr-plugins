import type { PluginManifest, WOPRPlugin, WOPRPluginContext } from "@wopr-network/plugin-types";
import { logger } from "./logger.js";
import { STARTUP_PERSONA } from "./persona.js";

let ctx: WOPRPluginContext | null = null;

const manifest: PluginManifest = {
  name: "@wopr-network/wopr-plugin-superpower-startup",
  version: "1.0.0",
  description:
    "Launch Your Startup -- a $5 co-founder who thinks about product, market, and execution. Never asks for equity.",
  author: "WOPR",
  license: "MIT",
  repository: "https://github.com/wopr-network/wopr-plugin-superpower-startup",
  capabilities: [],
  category: "superpower",
  icon: "\uD83D\uDE80",
  tags: ["wopr", "plugin", "superpower", "startup", "co-founder", "product"],
  dependencies: [
    "@wopr-network/wopr-plugin-skills",
    "@wopr-network/wopr-plugin-memory-semantic",
    "@wopr-network/wopr-plugin-cron",
  ],
  // @ts-expect-error WOP-1010 not yet published
  marketplace: {
    pitch: "./SUPERPOWER.md",
  },
  setup: [
    {
      id: "welcome",
      title: "Meet your co-founder",
      description: "Your $5 co-founder. Never asks for equity. Tell them about your startup to get started.",
    },
    {
      id: "startup-context",
      title: "Describe your startup",
      description: "Give your co-founder context so they can hit the ground running.",
      fields: {
        title: "Startup Context",
        description: "Tell your co-founder about the business",
        fields: [
          {
            name: "startupName",
            type: "text",
            label: "Startup Name",
            required: true,
            description: "What's your startup called?",
          },
          {
            name: "startupPitch",
            type: "text",
            label: "One-liner pitch",
            required: true,
            description: "Describe your startup in one sentence",
          },
          {
            name: "startupStage",
            type: "text",
            label: "Stage",
            description: "e.g., idea, MVP, launched, revenue",
          },
        ],
      },
    },
  ],
};

const plugin: WOPRPlugin = {
  name: "wopr-plugin-superpower-startup",
  version: "1.0.0",
  description: "Launch Your Startup -- a $5 co-founder. Never asks for equity.",
  manifest,

  async init(context: WOPRPluginContext) {
    ctx = context;

    context.registerContextProvider({
      name: "superpower-startup",
      priority: 90,
      enabled: true,
      async getContext() {
        return {
          content: STARTUP_PERSONA,
          role: "system" as const,
          metadata: { source: "superpower-startup", priority: 90 },
        };
      },
    });

    logger.info("Superpower: Startup initialized");
  },

  async shutdown() {
    if (ctx) {
      ctx.unregisterContextProvider("superpower-startup");
    }
    ctx = null;
  },
};

export default plugin;
