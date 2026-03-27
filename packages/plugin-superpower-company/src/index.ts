import type { PluginManifest, WOPRPlugin, WOPRPluginContext } from "@wopr-network/plugin-types";
import { logger } from "./logger.js";
import { COMPANY_PERSONA } from "./persona.js";

let ctx: WOPRPluginContext | null = null;

const manifest: PluginManifest = {
  name: "@wopr-network/wopr-plugin-superpower-company",
  version: "1.0.0",
  description:
    "Run a Company from Discord -- dedicated employee bots per channel that wake on schedule and coordinate with each other",
  author: "WOPR",
  license: "MIT",
  repository: "https://github.com/wopr-network/wopr-plugin-superpower-company",
  capabilities: [],
  category: "superpower",
  icon: "\uD83C\uDFE2",
  tags: ["wopr", "plugin", "superpower", "company", "discord", "team"],
  dependencies: [
    "@wopr-network/wopr-plugin-cron",
    "@wopr-network/wopr-plugin-gmail",
    "@wopr-network/wopr-plugin-discord",
    "@wopr-network/wopr-plugin-skills",
  ],
  // @ts-expect-error WOP-1010 not yet published
  marketplace: {
    pitch: "./SUPERPOWER.md",
  },
  setup: [
    {
      id: "welcome",
      title: "Your company lives in Discord now",
      description: "Each channel becomes a department. Each department gets a dedicated employee.",
    },
    {
      id: "discord",
      title: "Connect Discord",
      description: "Add your Discord bot token so employees can work in your server.",
      fields: {
        title: "Discord Bot",
        description: "Discord bot credentials",
        fields: [
          {
            name: "discordToken",
            type: "password",
            label: "Discord Bot Token",
            required: true,
            description: "Bot token from Discord Developer Portal",
          },
          {
            name: "discordGuildId",
            type: "text",
            label: "Server ID",
            required: true,
            description: "Your Discord server ID",
          },
        ],
      },
    },
    {
      id: "gmail",
      title: "Connect Gmail",
      description: "Let your employees send emails on behalf of departments.",
      fields: {
        title: "Gmail OAuth",
        description: "Authorize Gmail access",
        fields: [
          {
            name: "gmailOAuthToken",
            type: "password",
            label: "Gmail OAuth Token",
            required: true,
            description: "OAuth token for Gmail access",
          },
        ],
      },
      optional: true,
    },
  ],
};

const plugin: WOPRPlugin = {
  name: "wopr-plugin-superpower-company",
  version: "1.0.0",
  description: "Run a Company from Discord -- dedicated employee bots per channel",
  manifest,

  async init(context: WOPRPluginContext) {
    ctx = context;

    context.registerContextProvider({
      name: "superpower-company",
      priority: 90,
      enabled: true,
      async getContext() {
        return {
          content: COMPANY_PERSONA,
          role: "system" as const,
          metadata: { source: "superpower-company", priority: 90 },
        };
      },
    });

    logger.info("Superpower: Company initialized");
  },

  async shutdown() {
    if (ctx) {
      ctx.unregisterContextProvider("superpower-company");
    }
    ctx = null;
  },
};

export default plugin;
