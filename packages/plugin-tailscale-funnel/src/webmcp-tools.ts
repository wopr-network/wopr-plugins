// src/webmcp-tools.ts

import type { FunnelStats } from "./stats.js";
import type { FunnelInfo, FunnelStatus } from "./types.js";

/**
 * getFunnelStatus — Funnel enabled/disabled, public URL, tailnet hostname.
 * Security: No auth keys. Only public-facing information.
 */
export function buildFunnelStatusResponse(status: FunnelStatus): Record<string, unknown> {
	const activeFunnel = status.funnels.length > 0 ? status.funnels[0] : null;

	return {
		available: status.available,
		enabled: status.available && activeFunnel?.active === true,
		hostname: status.hostname || null,
		publicUrl: activeFunnel?.publicUrl || null,
		activeFunnel: activeFunnel
			? {
					port: activeFunnel.port,
					path: activeFunnel.path,
					publicUrl: activeFunnel.publicUrl,
					active: activeFunnel.active,
				}
			: null,
	};
}

/**
 * getFunnelRoutes — Active funnel routes and their target ports.
 * Tailscale Funnel only supports ONE active funnel at a time.
 */
export function buildFunnelRoutesResponse(status: FunnelStatus): Record<string, unknown> {
	return {
		count: status.funnels.length,
		routes: status.funnels.map((f: FunnelInfo) => ({
			port: f.port,
			path: f.path,
			publicUrl: f.publicUrl,
			active: f.active,
			target: `localhost:${f.port}`,
		})),
	};
}

/**
 * getTailscaleNodeStatus — Node online/offline, IP, tailnet name.
 * Security: NO auth keys. Only public node metadata.
 *
 * @param tailscaleStatusJson - Raw output from `tailscale status --json`, or null if unavailable
 * @param available - Whether Tailscale is available
 * @param hostname - Cached hostname
 */
export function buildNodeStatusResponse(
	tailscaleStatusJson: string | null,
	available: boolean,
	hostname: string | null,
): Record<string, unknown> {
	if (!tailscaleStatusJson || !available) {
		return {
			online: false,
			available: false,
			hostname: null,
			ip: null,
			tailnetName: null,
		};
	}

	try {
		const parsed = JSON.parse(tailscaleStatusJson);
		const self = parsed.Self || {};

		return {
			online: parsed.BackendState === "Running",
			available: true,
			hostname: hostname || self.DNSName?.replace(/\.$/, "") || null,
			ip: self.TailscaleIPs?.[0] || null,
			tailnetName: parsed.CurrentTailnet?.Name || null,
			backendState: parsed.BackendState || null,
			// Security: Explicitly exclude AuthURL, AuthKey, etc.
		};
	} catch {
		return {
			online: false,
			available,
			hostname,
			ip: null,
			tailnetName: null,
		};
	}
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

/**
 * Build stats response for the funnel_stats tool.
 */
export function buildStatsResponse(stats: FunnelStats): Record<string, unknown> {
	const uptimeMs = Date.now() - stats.startedAt;
	return {
		funnels: {
			started: stats.funnelsStarted,
			stopped: stats.funnelsStopped,
		},
		hostnameChanges: stats.hostnameChanges,
		statusChecks: stats.statusChecks,
		uptime: {
			ms: uptimeMs,
			seconds: Math.floor(uptimeMs / 1000),
			human: formatUptime(uptimeMs),
			startedAt: new Date(stats.startedAt).toISOString(),
		},
	};
}
