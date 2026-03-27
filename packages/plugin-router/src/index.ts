/**
 * WOPR Router Plugin
 *
 * Middleware-driven routing between channels and sessions.
 */

import { createReadStream } from "node:fs";
import http, { type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { extname, join } from "node:path";
import type { ConfigSchema, WOPRPluginContext, WOPRPlugin as WOPRPluginInterface } from "@wopr-network/plugin-types";
import {
	getStats,
	incrementErrors,
	incrementOutgoingRouted,
	incrementRouted,
	recordRouteHit,
	resetStats,
} from "./stats.js";
import { buildListRoutesResponse, buildRouterStatusResponse, buildRoutingStatsResponse } from "./webmcp-tools.js";

// Plugin-specific types (not in @wopr-network/plugin-types)
interface Route {
	sourceSession?: string;
	targetSessions?: string[];
	channelType?: string;
	channelId?: string;
}

interface OutgoingRoute {
	sourceSession?: string;
	channelType?: string;
	channelId?: string;
}

interface RouterConfig {
	uiPort?: number;
	routes?: Route[];
	outgoingRoutes?: OutgoingRoute[];
}

interface IncomingInput {
	session: string;
	channel?: { type: string; id: string };
	message: string;
}

interface OutgoingOutput {
	session: string;
	response: string;
}

// Extended context with middleware registration (router-specific capability)
interface RouterPluginContext extends WOPRPluginContext {
	registerMiddleware(middleware: {
		name: string;
		onIncoming?(input: IncomingInput): Promise<string>;
		onOutgoing?(output: OutgoingOutput): Promise<string>;
	}): void;
	unregisterMiddleware?(name: string): void;
}

const CONTENT_TYPES: Record<string, string> = {
	".js": "application/javascript",
	".css": "text/css",
	".html": "text/html",
};

let ctx: RouterPluginContext | null = null;
let uiServer: Server | null = null;
const cleanups: Array<() => void> = [];

function startUIServer(port: number = 7333): Server {
	const server = http.createServer((req: IncomingMessage, res: ServerResponse) => {
		const rawUrl = req.url || "/";

		// WebMCP API routes — return JSON, before static file serving
		if (rawUrl === "/api/webmcp/status") {
			res.setHeader("Content-Type", "application/json");
			res.setHeader("Access-Control-Allow-Origin", "*");
			try {
				const config = ctx?.getConfig<RouterConfig>() || {
					routes: [],
					outgoingRoutes: [],
				};
				res.end(JSON.stringify(buildRouterStatusResponse(config, uiServer !== null)));
			} catch (_error: unknown) {
				res.statusCode = 500;
				res.end(JSON.stringify({ error: "Internal server error" }));
			}
			return;
		}
		if (rawUrl === "/api/webmcp/routes") {
			res.setHeader("Content-Type", "application/json");
			res.setHeader("Access-Control-Allow-Origin", "*");
			try {
				const config = ctx?.getConfig<RouterConfig>() || {
					routes: [],
					outgoingRoutes: [],
				};
				res.end(JSON.stringify(buildListRoutesResponse(config)));
			} catch (_error: unknown) {
				res.statusCode = 500;
				res.end(JSON.stringify({ error: "Internal server error" }));
			}
			return;
		}
		if (rawUrl === "/api/webmcp/stats") {
			res.setHeader("Content-Type", "application/json");
			res.setHeader("Access-Control-Allow-Origin", "*");
			try {
				res.end(JSON.stringify(buildRoutingStatsResponse(getStats())));
			} catch (_error: unknown) {
				res.statusCode = 500;
				res.end(JSON.stringify({ error: "Internal server error" }));
			}
			return;
		}

		// Existing static file serving logic
		if (!ctx) {
			res.statusCode = 503;
			res.end("Service unavailable");
			return;
		}
		const relUrl = rawUrl === "/" ? "/ui.js" : rawUrl;
		// Prevent path traversal: decode percent-encoding before sanitizing so
		// encoded variants like %2e%2e bypass the literal ".." check are caught.
		let decodedUrl: string;
		try {
			decodedUrl = decodeURIComponent(relUrl);
		} catch {
			res.statusCode = 400;
			res.end("Bad request");
			return;
		}
		const safeSegment = decodedUrl.replace(/^\/+/, "").replace(/\.\./g, "");
		const pluginDir = ctx.getPluginDir();
		const filePath = join(pluginDir, "dist", safeSegment);
		const ext = extname(filePath).toLowerCase();

		res.setHeader("Content-Type", CONTENT_TYPES[ext] || "application/octet-stream");
		res.setHeader("Access-Control-Allow-Origin", "*");

		try {
			const stream = createReadStream(filePath);
			stream.pipe(res);
			stream.on("error", () => {
				res.statusCode = 404;
				res.end("Not found");
			});
		} catch (_error: unknown) {
			res.statusCode = 500;
			res.end("Error");
		}
	});

	server.listen(port, "127.0.0.1", () => {
		ctx?.log.info(`Router UI available at http://127.0.0.1:${port}`);
	});

	return server;
}

export function matchesRoute(route: Route, input: IncomingInput): boolean {
	if (route.sourceSession && route.sourceSession !== input.session) return false;
	if (route.channelType && route.channelType !== input.channel?.type) return false;
	if (route.channelId && route.channelId !== input.channel?.id) return false;
	return true;
}

async function fanOutToSessions(route: Route, input: IncomingInput): Promise<void> {
	const targets = route.targetSessions || [];
	for (const target of targets) {
		if (!target || target === input.session) continue;
		if (!ctx) {
			console.warn(
				`[wopr-plugin-router] ctx is null while routing from ${input.session} to ${target} — plugin may be shutting down`,
			);
			continue;
		}
		try {
			await ctx.inject(target, input.message);
			incrementRouted();
			recordRouteHit(input.session, target);
		} catch (err) {
			ctx?.log.error(`Failed to route message from ${input.session} to ${target}: ${err}`);
			incrementErrors();
		}
	}
}

async function fanOutToChannels(route: OutgoingRoute, output: OutgoingOutput): Promise<void> {
	const channels = ctx?.getChannelsForSession(output.session) ?? [];
	for (const adapter of channels) {
		if (route.channelType && adapter.channel.type !== route.channelType) continue;
		if (route.channelId && adapter.channel.id !== route.channelId) continue;
		try {
			await adapter.send(output.response);
			incrementOutgoingRouted();
		} catch (err) {
			ctx?.log.error(`Failed to send message to channel ${adapter.channel.type}:${adapter.channel.id}: ${err}`);
			incrementErrors();
		}
	}
}

const routerConfigSchema: ConfigSchema = {
	title: "Router Plugin Configuration",
	description: "Configure message routing between sessions and channels",
	fields: [
		{
			name: "uiPort",
			type: "number" as const,
			label: "UI Port",
			description: "Port for the routing UI server",
			default: 7333,
		},
		{
			name: "routes",
			type: "array" as const,
			label: "Incoming Routes",
			description: "Incoming message routing rules",
		},
		{
			name: "outgoingRoutes",
			type: "array" as const,
			label: "Outgoing Routes",
			description: "Outgoing response routing rules",
		},
	],
};

export const WOPRPlugin: WOPRPluginInterface = {
	name: "router",
	version: "0.3.0",
	description: "Message routing middleware between channels and sessions",

	manifest: {
		name: "router",
		version: "0.3.0",
		description: "Message routing middleware between channels and sessions",
		capabilities: ["message-routing"],
		category: "middleware",
		tags: ["routing", "middleware", "multi-bot", "channels"],
		icon: "route",
		requires: {},
		lifecycle: {
			shutdownBehavior: "graceful" as const,
		},
		configSchema: routerConfigSchema,
	},

	async init(pluginContext: WOPRPluginContext): Promise<void> {
		ctx = pluginContext as RouterPluginContext;

		ctx.registerConfigSchema("wopr-plugin-router", routerConfigSchema);
		cleanups.push(() => ctx?.unregisterConfigSchema?.("wopr-plugin-router"));

		const config = ctx.getConfig<RouterConfig>();
		const uiPort = config.uiPort || 7333;
		uiServer = startUIServer(uiPort);

		if (ctx.registerUiComponent) {
			ctx.registerUiComponent({
				id: "router-panel",
				title: "Message Router",
				moduleUrl: `http://127.0.0.1:${uiPort}/ui.js`,
				slot: "settings",
				description: "Configure message routing between sessions",
			});
			if (ctx.unregisterUiComponent) {
				cleanups.push(() => ctx?.unregisterUiComponent?.("router-panel"));
			}
			ctx.log.info("Registered Router UI component in WOPR settings");
		}

		// Register A2A server with routing stats tool
		if (ctx.registerA2AServer) {
			ctx.registerA2AServer({
				name: "router",
				version: "0.3.0",
				tools: [
					{
						name: "router.stats",
						description: "Get message routing statistics: messages routed, route hit counts, errors.",
						inputSchema: { type: "object", properties: {} },
						handler: async () => {
							return {
								content: [
									{
										type: "text" as const,
										text: JSON.stringify(buildRoutingStatsResponse(getStats())),
									},
								],
							};
						},
					},
				],
			});
			if (ctx.unregisterExtension) {
				cleanups.push(() => ctx?.unregisterExtension?.("a2a:router"));
			}
		}

		ctx.registerMiddleware({
			name: "router",
			async onIncoming(input: IncomingInput): Promise<string> {
				const config = ctx?.getConfig<RouterConfig>();
				const routes = config?.routes || [];
				for (const route of routes) {
					if (!matchesRoute(route, input)) continue;
					await fanOutToSessions(route, input);
				}
				return input.message;
			},
			async onOutgoing(output: OutgoingOutput): Promise<string> {
				const config = ctx?.getConfig<RouterConfig>();
				const routes = config?.outgoingRoutes || [];
				for (const route of routes) {
					if (route.sourceSession && route.sourceSession !== output.session) continue;
					await fanOutToChannels(route, output);
				}
				return output.response;
			},
		});
		cleanups.push(() => ctx?.unregisterMiddleware?.("router"));
	},

	async shutdown(): Promise<void> {
		for (const cleanup of cleanups) {
			try {
				cleanup();
			} catch (_error: unknown) {
				ctx?.log.error(`Cleanup error: ${_error instanceof Error ? _error.message : String(_error)}`);
			}
		}
		cleanups.length = 0;

		if (uiServer) {
			ctx?.log.info("Router UI server shutting down...");
			await new Promise<void>((resolve) => uiServer?.close(() => resolve()));
			uiServer = null;
		}

		resetStats();
		ctx = null;
	},
};

export default WOPRPlugin;
