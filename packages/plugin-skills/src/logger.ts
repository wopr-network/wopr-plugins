/**
 * Logger wrapper for plugin - delegates to WOPRPluginContext.log
 */

import type { PluginLogger } from "@wopr-network/plugin-types";

let pluginLogger: PluginLogger = {
  info: console.info,
  warn: console.warn,
  error: console.error,
  debug: console.info,
};

export function setLogger(log: PluginLogger): void {
  pluginLogger = log;
}

export const logger = new Proxy({} as typeof pluginLogger, {
  get(_target, prop) {
    return pluginLogger[prop as keyof typeof pluginLogger];
  },
});
