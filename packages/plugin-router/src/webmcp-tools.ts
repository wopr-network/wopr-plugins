// src/webmcp-tools.ts

import type { RoutingStats } from "./stats.js";

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
	routes?: Route[];
	outgoingRoutes?: OutgoingRoute[];
}

/**
 * getRouterStatus -- Router enabled/disabled, total routes configured.
 */
export function buildRouterStatusResponse(config: RouterConfig, serverRunning: boolean): Record<string, unknown> {
	const incomingRoutes = config.routes || [];
	const outgoingRoutes = config.outgoingRoutes || [];

	return {
		enabled: serverRunning,
		totalRoutes: incomingRoutes.length + outgoingRoutes.length,
		incoming: {
			count: incomingRoutes.length,
		},
		outgoing: {
			count: outgoingRoutes.length,
		},
	};
}

/**
 * listRoutes -- Routing rules as human-readable source->target mappings.
 */
export function buildListRoutesResponse(config: RouterConfig): Record<string, unknown> {
	const incomingRoutes = config.routes || [];
	const outgoingRoutes = config.outgoingRoutes || [];

	return {
		incoming: incomingRoutes.map((r: Route) => ({
			source: r.sourceSession || "*",
			targets: r.targetSessions || [],
			channelType: r.channelType || null,
			channelId: r.channelId || null,
			summary: `${r.sourceSession || "*"} -> ${(r.targetSessions || []).join(", ") || "(none)"}${r.channelType ? ` [${r.channelType}]` : ""}`,
		})),
		outgoing: outgoingRoutes.map((r: OutgoingRoute) => ({
			source: r.sourceSession || "*",
			channelType: r.channelType || null,
			channelId: r.channelId || null,
			summary: `${r.sourceSession || "*"} -> channels${r.channelType ? ` [${r.channelType}]` : ""}${r.channelId ? ` #${r.channelId}` : ""}`,
		})),
		totalRules: incomingRoutes.length + outgoingRoutes.length,
	};
}

/**
 * getRoutingStats -- Messages routed, route hit counts, errors.
 */
export function buildRoutingStatsResponse(stats: RoutingStats): Record<string, unknown> {
	const uptimeMs = Date.now() - stats.startedAt;

	return {
		messages: {
			routed: stats.messagesRouted,
			outgoingRouted: stats.outgoingRouted,
			total: stats.messagesRouted + stats.outgoingRouted,
			errors: stats.errors,
		},
		routeHits: Object.entries(stats.routeHits).map(([route, count]) => ({
			route,
			count,
		})),
		uptime: {
			ms: uptimeMs,
			seconds: Math.floor(uptimeMs / 1000),
			human: formatUptime(uptimeMs),
			startedAt: new Date(stats.startedAt).toISOString(),
		},
	};
}

function formatUptime(ms: number): string {
	const seconds = Math.floor(ms / 1000);
	const minutes = Math.floor(seconds / 60);
	const hours = Math.floor(minutes / 60);
	const days = Math.floor(hours / 24);
	if (days > 0) return `${days}d ${hours % 24}h`;
	if (hours > 0) return `${hours}h ${minutes % 60}m`;
	if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
	return `${seconds}s`;
}
