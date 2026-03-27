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

export interface HttpPluginConfig {
	allowedDomains?: string[];
	blockedDomains?: string[];
	maxTimeout?: number;
	maxResponseSize?: number;
}
