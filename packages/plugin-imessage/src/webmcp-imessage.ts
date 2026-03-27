/**
 * WebMCP iMessage Tools
 *
 * Registers 3 read-only browser-side WebMCP tools for iMessage connection
 * status, chat listing, and message stats.
 *
 * These tools call the WOPR daemon REST API via fetch() and are only
 * meaningful when the iMessage plugin is loaded on the instance.
 */

// ============================================================================
// Types (mirrors WebMCPRegistry from wopr-plugin-webui)
// ============================================================================

export interface AuthContext {
	token?: string;
	[key: string]: unknown;
}

export interface ParameterSchema {
	type: string;
	description: string;
	required?: boolean;
}

export interface WebMCPTool {
	name: string;
	description: string;
	parameters: Record<string, ParameterSchema>;
	handler: (
		params: Record<string, unknown>,
		auth: AuthContext,
	) => Promise<unknown>;
}

export interface WebMCPRegistry {
	register(tool: WebMCPTool): void;
	get(name: string): WebMCPTool | undefined;
	list(): string[];
}

// ============================================================================
// Internal helpers
// ============================================================================

interface RequestOptions {
	method?: string;
	body?: string;
	headers?: Record<string, string>;
}

async function daemonRequest<T>(
	apiBase: string,
	path: string,
	auth: AuthContext,
	options?: RequestOptions,
): Promise<T> {
	const headers: Record<string, string> = {
		"Content-Type": "application/json",
		...options?.headers,
	};
	if (auth.token) {
		headers.Authorization = `Bearer ${auth.token as string}`;
	}
	const res = await fetch(`${apiBase}${path}`, {
		...options,
		headers,
	});
	if (!res.ok) {
		const err = await res.json().catch(() => ({ error: "Request failed" }));
		throw new Error(
			(err as { error?: string }).error || `Request failed (${res.status})`,
		);
	}
	return res.json() as Promise<T>;
}

// ============================================================================
// Tool registration
// ============================================================================

/**
 * Register all 3 iMessage WebMCP tools on the given registry.
 *
 * The tools proxy to the iMessage plugin via daemon API endpoints
 * at `/plugins/imessage/status`, `/plugins/imessage/chats`, etc.
 *
 * @param registry - The WebMCPRegistry instance to register tools on
 * @param apiBase  - Base URL of the WOPR daemon API (e.g. "/api" or "http://localhost:7437")
 */
export function registerImessageTools(
	registry: WebMCPRegistry,
	apiBase = "/api",
): void {
	// 1. getImessageStatus
	registry.register({
		name: "getImessageStatus",
		description:
			"Get iMessage connection status: connected/disconnected and service type. Does not expose Apple ID credentials.",
		parameters: {},
		handler: async (_params: Record<string, unknown>, auth: AuthContext) => {
			return daemonRequest(apiBase, "/plugins/imessage/status", auth);
		},
	});

	// 2. listImessageChats
	registry.register({
		name: "listImessageChats",
		description:
			"List active iMessage conversations with chat IDs and display names.",
		parameters: {
			limit: {
				type: "number",
				description: "Maximum number of chats to return (default: 20)",
				required: false,
			},
		},
		handler: async (params: Record<string, unknown>, auth: AuthContext) => {
			const limit =
				params.limit !== undefined
					? `?limit=${encodeURIComponent(String(params.limit))}`
					: "";
			return daemonRequest(apiBase, `/plugins/imessage/chats${limit}`, auth);
		},
	});

	// 3. getImessageMessageStats
	registry.register({
		name: "getImessageMessageStats",
		description:
			"Get iMessage processing statistics: queued messages and active conversation count.",
		parameters: {},
		handler: async (_params: Record<string, unknown>, auth: AuthContext) => {
			return daemonRequest(apiBase, "/plugins/imessage/stats", auth);
		},
	});
}
