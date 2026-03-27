/**
 * Runtime context — injected at plugin init time.
 *
 * Replaces core-internal imports (logger, getStorage, config)
 * with plugin-context equivalents set during init().
 */

import type { PluginLogger, StorageApi } from "@wopr-network/plugin-types";

/** Minimal logger matching PluginLogger but available pre-init as a no-op. */
const noopLogger: PluginLogger = {
  info() {},
  warn() {},
  error() {},
  debug() {},
};

let _logger: PluginLogger = noopLogger;
let _storage: StorageApi | null = null;
let _getMainConfig: ((key?: string) => unknown) | null = null;

export function setRuntime(deps: {
  logger: PluginLogger;
  storage: StorageApi;
  getMainConfig: (key?: string) => unknown;
}) {
  _logger = deps.logger;
  _storage = deps.storage;
  _getMainConfig = deps.getMainConfig;
}

export function getLogger(): PluginLogger {
  return _logger;
}

export function getStorage(): StorageApi {
  if (!_storage) {
    throw new Error("[sandbox] Storage not initialized — plugin init() has not been called");
  }
  return _storage;
}

export function getMainConfig(): unknown {
  if (!_getMainConfig) {
    throw new Error("[sandbox] Config not initialized — plugin init() has not been called");
  }
  return _getMainConfig();
}
