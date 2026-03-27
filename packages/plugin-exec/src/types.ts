export type {
  A2AServerConfig,
  A2AToolDefinition,
  A2AToolResult,
  ConfigField,
  ConfigSchema,
  PluginCommand,
  PluginManifest,
  WOPRPlugin,
  WOPRPluginContext,
} from "@wopr-network/plugin-types";

export interface ExecPluginConfig {
  allowedCommands?: string[];
  blockShellOperators?: boolean;
  maxExecTimeout?: number;
  maxOutputSize?: number;
  stripEnv?: boolean;
}
