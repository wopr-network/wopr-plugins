/**
 * WOPR Tools Meta Package
 *
 * This is a meta-package that provides both http_fetch and exec_command capabilities
 * by depending on wopr-plugin-http and wopr-plugin-exec.
 *
 * Install this plugin and it will automatically pull in the http and exec dependencies.
 */

import type { PluginManifest, WOPRPlugin, WOPRPluginContext } from "@wopr-network/plugin-types";

const manifest: PluginManifest = {
  name: "wopr-plugin-tools",
  version: "2.0.0",
  description: "Meta package providing http_fetch and exec_command - depends on wopr-plugin-http and wopr-plugin-exec",
  capabilities: ["a2a"],
  dependencies: ["wopr-plugin-http", "wopr-plugin-exec"],
};

const plugin: WOPRPlugin = {
  name: "wopr-plugin-tools",
  version: "2.0.0",
  description: "HTTP fetch and shell exec tools (meta package)",
  manifest,

  async init(context: WOPRPluginContext) {
    context.log.info("Tools meta-package initialized");
    context.log.info("Dependencies: wopr-plugin-http, wopr-plugin-exec");
  },
};

export default plugin;
