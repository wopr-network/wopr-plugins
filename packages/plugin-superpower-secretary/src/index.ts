import type { PluginManifest, WOPRPlugin, WOPRPluginContext } from "@wopr-network/plugin-types";
import { logger } from "./logger.js";
import { SECRETARY_PERSONA } from "./persona.js";

let ctx: WOPRPluginContext | null = null;

const manifest: PluginManifest = {
  name: "@wopr-network/wopr-plugin-superpower-secretary",
  version: "1.0.0",
  description:
    "Fire Your Secretary -- a proactive chief of staff that manages your schedule, drafts emails, and never calls in sick",
  author: "WOPR",
  license: "MIT",
  repository: "https://github.com/wopr-network/wopr-plugin-superpower-secretary",
  capabilities: [],
  category: "superpower",
  icon: "\uD83D\uDCBC",
  tags: ["wopr", "plugin", "superpower", "secretary", "productivity", "email", "calendar"],
  dependencies: [
    "@wopr-network/wopr-plugin-cron",
    "@wopr-network/wopr-plugin-gmail",
    "@wopr-network/wopr-plugin-calendar",
  ],
  // @ts-expect-error WOP-1010 not yet published
  marketplace: {
    pitch: "./SUPERPOWER.md",
  },
  setup: [
    {
      id: "welcome",
      title: "Meet your new secretary",
      description: "She never calls in sick. Connect your email and calendar to get started.",
    },
    {
      id: "gmail",
      title: "Connect Gmail",
      description: "Grant access so your secretary can read, draft, and send emails on your behalf.",
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
    },
    {
      id: "calendar",
      title: "Connect Calendar",
      description: "Grant access so your secretary can manage your schedule.",
      fields: {
        title: "Calendar OAuth",
        description: "Authorize Calendar access",
        fields: [
          {
            name: "calendarOAuthToken",
            type: "password",
            label: "Calendar OAuth Token",
            required: true,
            description: "OAuth token for Calendar access",
          },
        ],
      },
    },
  ],
};

const plugin: WOPRPlugin = {
  name: "wopr-plugin-superpower-secretary",
  version: "1.0.0",
  description: "Fire Your Secretary -- proactive chief of staff",
  manifest,

  async init(context: WOPRPluginContext) {
    ctx = context;

    context.registerContextProvider({
      name: "superpower-secretary",
      priority: 90,
      enabled: true,
      async getContext() {
        return {
          content: SECRETARY_PERSONA,
          role: "system" as const,
          metadata: { source: "superpower-secretary", priority: 90 },
        };
      },
    });

    logger.info("Superpower: Secretary initialized");
  },

  async shutdown() {
    if (ctx) {
      ctx.unregisterContextProvider("superpower-secretary");
    }
    ctx = null;
  },
};

export default plugin;
