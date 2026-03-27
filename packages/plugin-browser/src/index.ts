/**
 * wopr-plugin-browser — Browser automation plugin for WOPR.
 *
 * Provides Playwright-based browser automation via A2A tools:
 * browser_navigate, browser_click, browser_type, browser_screenshot, browser_evaluate.
 *
 * Browser profiles persist cookies/sessions across invocations via the Storage API.
 */

import type { WOPRPlugin, WOPRPluginContext } from "@wopr-network/plugin-types";
import { buildBrowserA2ATools, closeAllBrowsers } from "./browser.js";
import { initBrowserProfileStorage, resetStorage } from "./browser-profile.js";

export interface BrowserPluginConfig {
  headless?: boolean;
  defaultTimeout?: number;
}

const plugin: WOPRPlugin = {
  name: "wopr-plugin-browser",
  version: "1.0.0",
  description: "Browser automation — Playwright-based web interaction with profile persistence",
  manifest: {
    name: "wopr-plugin-browser",
    version: "1.0.0",
    description: "Browser automation — Playwright-based web interaction with profile persistence",
    category: "utility",
    tags: ["browser", "automation", "playwright", "scraping"],
    icon: "globe",
    capabilities: ["browser-automation"],
    requires: {},
    lifecycle: {},
    configSchema: {
      title: "Browser Plugin Configuration",
      description: "Configure Playwright browser automation settings",
      fields: [
        {
          name: "headless",
          type: "boolean",
          label: "Headless Mode",
          description: "Run browser in headless mode",
          default: true,
        },
        {
          name: "defaultTimeout",
          type: "number",
          label: "Default Timeout (ms)",
          description: "Default navigation timeout in milliseconds",
          default: 30000,
        },
      ],
    },
  },

  async init(ctx: WOPRPluginContext) {
    // 1. Initialize browser profile storage
    await initBrowserProfileStorage(ctx.storage);

    // 2. Read plugin config for headless mode
    const config = ctx.getConfig<BrowserPluginConfig>();
    const headless = config?.headless ?? true;

    // 3. Register A2A tools
    if (ctx.registerA2AServer) {
      ctx.registerA2AServer(buildBrowserA2ATools(ctx.log, headless));
    }

    ctx.log.info("Browser plugin initialized (headless: %s)", headless);
  },

  async shutdown() {
    // Close all open browser instances and persist profiles
    // Use a minimal logger for shutdown since context may be gone
    const shutdownLog = {
      info: console.info,
      warn: console.warn,
      error: console.error,
      debug: console.info,
    };
    await closeAllBrowsers(shutdownLog);
    resetStorage();
  },
};

export default plugin;
