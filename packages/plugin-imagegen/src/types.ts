export type {
  A2AServerConfig,
  A2AToolDefinition,
  A2AToolResult,
  ChannelCommand,
  ChannelCommandContext,
  ChannelProvider,
  ConfigField,
  ConfigSchema,
  PluginCommand,
  PluginManifest,
  WOPRPlugin,
  WOPRPluginContext,
} from "@wopr-network/plugin-types";

/** Parsed flags from /imagine prompt string */
export interface ImagineRequest {
  prompt: string;
  model?: string;
  size?: string;
  style?: string;
}

/** Response from the image generation capability request */
export interface ImagineResponse {
  imageUrl?: string;
  error?: string;
}

/** Plugin config shape */
export interface ImageGenConfig {
  defaultModel?: string;
  defaultSize?: string;
  defaultStyle?: string;
  maxPromptLength?: number;
}
