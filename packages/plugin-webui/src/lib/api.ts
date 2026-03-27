/**
 * WOPR API Client
 */
import type {
	PluginUiComponentProps,
	StreamMessage,
	UiComponentExtension,
	WebUiExtension,
} from "@wopr-network/plugin-types";

export type { PluginUiComponentProps, StreamMessage, UiComponentExtension, WebUiExtension };

const API_BASE = "/api";

export interface WoprConfig {
	daemon: {
		port: number;
		host: string;
		autoStart: boolean;
	};
	anthropic: {
		apiKey?: string;
	};
	oauth: {
		clientId?: string;
		clientSecret?: string;
		redirectUri?: string;
	};
	discord?: {
		token?: string;
		guildId?: string;
	};
	discovery: {
		topics: string[];
		autoJoin: boolean;
	};
	plugins: {
		autoLoad: boolean;
		directories: string[];
	};
}

export interface Session {
	name: string;
	id?: string;
	context?: string;
}

export interface StreamEvent {
	type: "stream" | "injection" | "connected" | "subscribed";
	session?: string;
	from?: string;
	message: StreamMessage;
	ts?: number;
}

// --- Manifest-driven panel types ---

export interface WebUIPanel {
	id: string;
	title: string;
	icon?: string;
	type: "status" | "config" | "logs" | "metrics" | "custom";
	endpoints?: string[];
	configFields?: string[];
	component?: string;
	pollIntervalMs?: number;
}

export interface WebUIRoute {
	path: string;
	title: string;
	icon?: string;
	component: string;
}

export interface WebUIManifest {
	panels?: WebUIPanel[];
	routes?: WebUIRoute[];
}

export interface WebMCPToolDeclaration {
	name: string;
	description: string;
	inputSchema?: Record<string, unknown>;
	annotations?: { readOnlyHint?: boolean };
}

export interface PluginManifestSummary {
	name: string;
	version: string;
	description: string;
	icon?: string;
	capabilities: string[];
	configSchema?: {
		title: string;
		description?: string;
		fields: ConfigFieldDef[];
	};
	lifecycle?: {
		healthEndpoint?: string;
		healthIntervalMs?: number;
	};
	webui?: WebUIManifest;
	webmcpTools?: WebMCPToolDeclaration[];
}

export interface ConfigFieldDef {
	name: string;
	type: string;
	label: string;
	placeholder?: string;
	required?: boolean;
	default?: unknown;
	options?: { value: string; label: string }[];
	description?: string;
	secret?: boolean;
}

export interface InjectResponse {
	session: string;
	sessionId: string;
	response: string;
	cost: number;
}

export type PluginCategory = "channel" | "provider" | "voice" | "memory" | "utility";

export interface InstalledPlugin {
	id: string;
	name: string;
	version: string;
	enabled: boolean;
	healthy: boolean;
	description?: string;
	category?: PluginCategory;
	updateAvailable?: string;
	configSchema?: Record<string, ConfigSchemaField>;
}

export interface AvailablePlugin {
	name: string;
	description: string;
	version: string;
	category?: PluginCategory;
	requirements?: string[];
	setupSteps?: string[];
	configSchema?: Record<string, ConfigSchemaField>;
}

export interface ConfigSchemaField {
	type: "string" | "number" | "boolean" | "select";
	label: string;
	description?: string;
	default?: unknown;
	required?: boolean;
	options?: { label: string; value: string }[];
}

export interface InstalledSkill {
	id: string;
	name: string;
	description: string;
	enabled: boolean;
	version?: string;
	category?: string;
}

export interface AvailableSkill {
	id: string;
	name: string;
	description: string;
	category?: string;
	version?: string;
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
	const res = await fetch(`${API_BASE}${path}`, {
		...options,
		headers: {
			"Content-Type": "application/json",
			...options?.headers,
		},
	});

	if (!res.ok) {
		const error = await res.json().catch(() => ({ error: "Request failed" }));
		throw new Error(error.error || "Request failed");
	}

	return res.json();
}

export const api = {
	// Sessions
	async getSessions(): Promise<{ sessions: Session[] }> {
		return request("/sessions");
	},

	async createSession(name: string, context?: string): Promise<Session> {
		return request("/sessions", {
			method: "POST",
			body: JSON.stringify({ name, context }),
		});
	},

	async deleteSession(name: string): Promise<void> {
		await request(`/sessions/${encodeURIComponent(name)}`, {
			method: "DELETE",
		});
	},

	async inject(session: string, message: string): Promise<InjectResponse> {
		return request(`/sessions/${encodeURIComponent(session)}/inject`, {
			method: "POST",
			body: JSON.stringify({ message }),
		});
	},

	// Auth
	async getAuthStatus(): Promise<{ authenticated: boolean; type?: string }> {
		return request("/auth");
	},

	// Crons
	async getCrons(): Promise<{ crons: any[] }> {
		return request("/crons");
	},

	async createCron(cron: { name: string; schedule: string; session: string; message: string }): Promise<any> {
		return request("/crons", {
			method: "POST",
			body: JSON.stringify(cron),
		});
	},

	async deleteCron(name: string): Promise<void> {
		await request(`/crons/${encodeURIComponent(name)}`, {
			method: "DELETE",
		});
	},

	// Peers
	async getPeers(): Promise<{ peers: any[] }> {
		return request("/peers");
	},

	// Plugins
	async getPlugins(): Promise<{ plugins: InstalledPlugin[] }> {
		return request("/plugins");
	},

	async getAvailablePlugins(): Promise<{ plugins: AvailablePlugin[] }> {
		return request("/plugins/available");
	},

	async installPlugin(name: string): Promise<{ plugin: InstalledPlugin }> {
		return request("/plugins/install", {
			method: "POST",
			body: JSON.stringify({ name }),
		});
	},

	async uninstallPlugin(id: string): Promise<void> {
		await request("/plugins/uninstall", {
			method: "POST",
			body: JSON.stringify({ id }),
		});
	},

	async enablePlugin(id: string): Promise<void> {
		await request(`/plugins/${encodeURIComponent(id)}/enable`, {
			method: "POST",
		});
	},

	async disablePlugin(id: string): Promise<void> {
		await request(`/plugins/${encodeURIComponent(id)}/disable`, {
			method: "POST",
		});
	},

	async getPluginConfig(id: string): Promise<Record<string, unknown>> {
		return request(`/plugins/${encodeURIComponent(id)}/config`);
	},

	async updatePluginConfig(id: string, config: Record<string, unknown>): Promise<void> {
		await request(`/plugins/${encodeURIComponent(id)}/config`, {
			method: "PUT",
			body: JSON.stringify(config),
		});
	},

	// Plugin manifests (declarative panels)
	async getPluginManifests(): Promise<{ manifests: PluginManifestSummary[] }> {
		return request("/plugins/manifests");
	},

	// Poll a plugin endpoint (status/metrics)
	async pollPluginEndpoint(pluginName: string, endpoint: string): Promise<unknown> {
		const normalized = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
		return request(`/plugins/${encodeURIComponent(pluginName)}/proxy${normalized}`);
	},

	// Set a plugin config value
	async setPluginConfigValue(pluginName: string, key: string, value: unknown): Promise<void> {
		await request(`/plugins/${encodeURIComponent(pluginName)}/config/${encodeURIComponent(key)}`, {
			method: "PUT",
			body: JSON.stringify({ value }),
		});
	},

	// Web UI Extensions
	async getWebUiExtensions(): Promise<{ extensions: WebUiExtension[] }> {
		return request("/plugins/ui");
	},

	// UI Component Extensions
	async getUiComponents(): Promise<{ components: UiComponentExtension[] }> {
		return request("/plugins/components");
	},

	// Identity
	async getIdentity(): Promise<any> {
		return request("/identity");
	},

	async initIdentity(force?: boolean): Promise<any> {
		return request("/identity", {
			method: "POST",
			body: JSON.stringify({ force }),
		});
	},

	// Config
	async getConfig(): Promise<WoprConfig> {
		return request("/config");
	},

	async getConfigValue(key: string): Promise<any> {
		const data = await request<{ key: string; value: any }>(`/config/${encodeURIComponent(key)}`);
		return data.value;
	},

	async setConfigValue(key: string, value: any): Promise<void> {
		await request(`/config/${encodeURIComponent(key)}`, {
			method: "PUT",
			body: JSON.stringify({ value }),
		});
	},

	async resetConfig(): Promise<void> {
		await request("/config", {
			method: "DELETE",
		});
	},

	// Skills
	async getSkills(): Promise<{ skills: InstalledSkill[] }> {
		return request("/skills");
	},

	async getAvailableSkills(): Promise<{ skills: AvailableSkill[] }> {
		return request("/skills/available");
	},

	async installSkill(id: string): Promise<void> {
		await request("/skills/install", {
			method: "POST",
			body: JSON.stringify({ id }),
		});
	},

	async uninstallSkill(id: string): Promise<void> {
		await request("/skills/uninstall", {
			method: "POST",
			body: JSON.stringify({ id }),
		});
	},

	async enableSkill(id: string): Promise<void> {
		await request(`/skills/${encodeURIComponent(id)}/enable`, {
			method: "POST",
		});
	},

	async disableSkill(id: string): Promise<void> {
		await request(`/skills/${encodeURIComponent(id)}/disable`, {
			method: "POST",
		});
	},
};
