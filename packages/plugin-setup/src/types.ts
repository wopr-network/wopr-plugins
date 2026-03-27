import type { ConfigSchema } from "@wopr-network/plugin-types";

/** A mutation recorded during a setup session for rollback support. */
export type SetupMutation =
  | { type: "saveConfig"; key: string; value: unknown }
  | { type: "installDependency"; pluginId: string };

/** Tracks all state for a single setup conversation. */
export interface SetupSession {
  sessionId: string;
  pluginId: string;
  configSchema: ConfigSchema;
  mutations: SetupMutation[];
  collectedValues: Map<string, unknown>;
  completed: boolean;
  createdAt: number;
}

/** The extension API surface exposed via ctx.registerExtension("setup", ...). */
export interface SetupExtension {
  beginSetup(pluginId: string, configSchema: ConfigSchema, sessionId: string): Promise<void>;
  getSession(sessionId: string): SetupSession | undefined;
  isSetupActive(sessionId: string): boolean;
}
