/**
 * WOPR Tailscale Funnel Plugin
 *
 * Exposes local WOPR services to the internet via Tailscale Funnel.
 * Other plugins can use the funnel extension to get public URLs.
 */

import { execSync, spawn, spawnSync } from "node:child_process";
import type { PluginManifest } from "@wopr-network/plugin-types";
import { getStats, incrementStat, resetStats } from "./stats.js";
import type {
	ConfigSchema,
	FunnelConfig,
	FunnelExtension,
	FunnelInfo,
	FunnelStatus,
	HostnameChangeCallback,
	WOPRPlugin,
	WOPRPluginContext,
} from "./types.js";
import {
	buildFunnelRoutesResponse,
	buildFunnelStatusResponse,
	buildNodeStatusResponse,
	buildStatsResponse,
} from "./webmcp-tools.js";

// ============================================================================
// State
// ============================================================================

let ctx: WOPRPluginContext | null = null;
let hostname: string | null = null;
let available: boolean | null = null;

// Tailscale Funnel only supports ONE active funnel at a time
// Exposing a new port will replace the previous one
let activeFunnel: (FunnelInfo & { pid?: number }) | null = null;

// Hostname polling state
let pollTimer: ReturnType<typeof setInterval> | null = null;
const hostnameChangeCallbacks: HostnameChangeCallback[] = [];

// ============================================================================
// Tailscale CLI Helpers
// ============================================================================

function exec(cmd: string): string | null {
	try {
		return execSync(cmd, { encoding: "utf-8", timeout: 10000 }).trim();
	} catch {
		return null;
	}
}

function getTailscaleStatusJson(): string | null {
	incrementStat("statusChecks");
	return exec("tailscale status --json");
}

async function checkTailscaleAvailable(): Promise<boolean> {
	if (available !== null) return available;

	// Check if tailscale CLI exists (cross-platform: 'where' on Windows, 'which' elsewhere)
	const isWindows = process.platform === "win32";
	const whichCmd = isWindows ? "where tailscale" : "which tailscale";
	const which = exec(whichCmd);
	if (!which) {
		ctx?.log.warn("Tailscale CLI not found. Install from https://tailscale.com/download");
		available = false;
		return false;
	}

	// Check if tailscale is running and connected
	const status = exec("tailscale status --json");
	if (!status) {
		ctx?.log.warn("Tailscale not running or not connected");
		available = false;
		return false;
	}

	try {
		const parsed = JSON.parse(status);
		if (parsed.BackendState !== "Running") {
			ctx?.log.warn(`Tailscale backend state: ${parsed.BackendState}`);
			available = false;
			return false;
		}

		// Extract hostname
		hostname = parsed.Self?.DNSName?.replace(/\.$/, "") || null;
		if (hostname) {
			ctx?.log.info(`Tailscale connected: ${hostname}`);
		}

		available = true;
		return true;
	} catch {
		available = false;
		return false;
	}
}

async function getTailscaleHostname(): Promise<string | null> {
	if (hostname) return hostname;
	await checkTailscaleAvailable();
	return hostname;
}

/**
 * Poll tailscale status for hostname changes. When a change is detected:
 * 1. Update the cached hostname
 * 2. Update the active funnel's publicUrl if one is active
 * 3. Emit `funnel:hostname-changed` via the event bus
 * 4. Notify registered callbacks
 */
async function pollHostname(): Promise<void> {
	const status = exec("tailscale status --json");
	if (!status) return;

	try {
		const parsed = JSON.parse(status);
		if (parsed.BackendState !== "Running") return;

		const newHostname = parsed.Self?.DNSName?.replace(/\.$/, "") || null;
		if (!newHostname || newHostname === hostname) return;

		// First poll after startup: hostname is null, just initialize it
		if (!hostname) {
			hostname = newHostname;
			return;
		}

		const oldHostname = hostname;
		hostname = newHostname;
		incrementStat("hostnameChanges");
		ctx?.log.info(`Tailscale hostname changed: ${oldHostname} -> ${newHostname}`);

		// Update active funnel publicUrl
		if (activeFunnel?.active) {
			const oldUrl = activeFunnel.publicUrl;
			activeFunnel.publicUrl = oldUrl.replace(oldHostname, newHostname);
			ctx?.log.info(`Updated funnel URL: ${activeFunnel.publicUrl}`);
		}

		// Emit event via event bus
		const payload = {
			oldHostname,
			newHostname,
			activePort: activeFunnel?.active ? activeFunnel.port : null,
			publicUrl: activeFunnel?.active ? activeFunnel.publicUrl : null,
		};
		await ctx?.events?.emitCustom("funnel:hostname-changed", payload);

		// Notify registered callbacks
		for (const cb of hostnameChangeCallbacks) {
			try {
				cb(oldHostname, newHostname);
			} catch (err) {
				ctx?.log.error(`Hostname change callback error: ${err}`);
			}
		}
	} catch {
		// Ignore parse errors during polling
	}
}

async function startFunnel(port: number, path: string = "/"): Promise<string | null> {
	if (!(await checkTailscaleAvailable())) {
		return null;
	}

	if (!hostname) {
		ctx?.log.error("No Tailscale hostname available");
		return null;
	}

	// Check if already exposed on this port
	if (activeFunnel?.active && activeFunnel.port === port) {
		ctx?.log.debug?.(`Port ${port} already exposed at ${activeFunnel.publicUrl}`);
		return activeFunnel.publicUrl;
	}

	// Tailscale only supports ONE funnel at a time - stop any existing funnel
	if (activeFunnel?.active) {
		ctx?.log.info(`Replacing existing funnel on port ${activeFunnel.port} with port ${port}`);
		await stopFunnel(activeFunnel.port);
	}

	// Build public URL
	// Funnel always uses HTTPS on port 443
	const publicUrl = `https://${hostname}${path === "/" ? "" : path}`;

	try {
		// Start funnel in background
		// tailscale funnel <port> exposes on 443 by default
		const funnelProcess = spawn("tailscale", ["funnel", String(port)], {
			detached: true,
			stdio: "ignore",
		});

		// Handle spawn errors (e.g., tailscale not found)
		funnelProcess.on("error", (err) => {
			ctx?.log.error(`Funnel process error for port ${port}: ${err.message}`);
			if (activeFunnel?.port === port) {
				activeFunnel = null;
			}
		});

		funnelProcess.unref();

		// Store state - note: we can't verify funnel actually started since it's detached
		// The error handler above will clear state if spawn fails
		activeFunnel = {
			port,
			path,
			publicUrl,
			active: true,
			pid: funnelProcess.pid,
		};
		incrementStat("funnelsStarted");

		ctx?.log.info(`Funnel started: ${publicUrl} -> localhost:${port}`);
		return publicUrl;
	} catch (err) {
		ctx?.log.error(`Failed to spawn funnel for port ${port}: ${err}`);
		return null;
	}
}

async function stopFunnel(port: number): Promise<boolean> {
	if (!activeFunnel || activeFunnel.port !== port) {
		return false;
	}

	// Stop the funnel using spawnSync with args array (safer than shell string)
	const result = spawnSync("tailscale", ["funnel", String(port), "off"], {
		encoding: "utf-8",
		timeout: 10000,
	});
	if (result.status !== 0) {
		ctx?.log.warn(`tailscale funnel ${port} off may have failed: ${result.stderr || ""}`);
	}

	// Also try to kill the process if we have the PID
	if (activeFunnel.pid) {
		try {
			process.kill(activeFunnel.pid, "SIGTERM");
		} catch {
			// Process may already be dead
		}
	}

	activeFunnel = null;
	incrementStat("funnelsStopped");
	ctx?.log.info(`Funnel stopped for port ${port}`);
	return true;
}

// ============================================================================
// Extension
// ============================================================================

const funnelExtension: FunnelExtension = {
	async isAvailable() {
		return checkTailscaleAvailable();
	},

	async getHostname() {
		return getTailscaleHostname();
	},

	async expose(port: number, path?: string) {
		return startFunnel(port, path || "/");
	},

	async unexpose(port: number) {
		return stopFunnel(port);
	},

	getUrl(port: number) {
		return activeFunnel?.port === port ? activeFunnel.publicUrl : null;
	},

	getStatus(): FunnelStatus {
		return {
			available: available ?? false,
			hostname: hostname || undefined,
			funnels: activeFunnel ? [activeFunnel] : [],
		};
	},

	onHostnameChange(callback: HostnameChangeCallback) {
		hostnameChangeCallbacks.push(callback);
	},

	getPort(): number | null {
		return activeFunnel?.active ? activeFunnel.port : null;
	},
};

// ============================================================================
// Plugin
// ============================================================================

const manifest: PluginManifest = {
	name: "@wopr-network/wopr-plugin-tailscale-funnel",
	version: "1.0.0",
	description: "Expose WOPR services externally via Tailscale Funnel",
	author: "wopr-network",
	license: "MIT",
	repository: "https://github.com/wopr-network/wopr-plugin-tailscale-funnel",
	homepage: "https://github.com/wopr-network/wopr-plugin-tailscale-funnel#readme",
	capabilities: ["utility"],
	requires: {
		bins: ["tailscale"],
		network: {
			outbound: true,
			inbound: true,
			p2p: false,
		},
	},
};

const configSchema: ConfigSchema = {
	title: "Tailscale Funnel",
	description: "Expose a local service to the internet via Tailscale Funnel (one port at a time)",
	fields: [
		{
			name: "enabled",
			type: "boolean",
			label: "Enable Funnel",
			description: "Enable Tailscale Funnel integration",
			default: true,
		},
		{
			name: "expose",
			type: "object",
			label: "Auto-expose port",
			description: "Port to automatically expose on startup (only one supported)",
		},
		{
			name: "pollIntervalSeconds",
			type: "number",
			label: "Hostname poll interval",
			description: "How often (in seconds) to check for hostname changes. 0 to disable.",
			default: 60,
		},
	],
};

const plugin: WOPRPlugin = {
	name: "@wopr-network/wopr-plugin-tailscale-funnel",
	version: "1.0.0",
	description: "Expose WOPR services externally via Tailscale Funnel",
	manifest,

	commands: [
		{
			name: "funnel",
			description: "Tailscale Funnel management",
			usage: "wopr funnel <status|expose|unexpose> [port]",
			async handler(cmdCtx, args) {
				const [subcommand, portArg] = args;

				if (subcommand === "status") {
					const status = funnelExtension.getStatus();
					if (!status.available) {
						cmdCtx.log.info("Tailscale Funnel: not available");
						cmdCtx.log.info("  Make sure Tailscale is installed and running");
						return;
					}
					cmdCtx.log.info(`Tailscale Funnel: available`);
					cmdCtx.log.info(`  Hostname: ${status.hostname}`);
					cmdCtx.log.info(`  Active funnels: ${status.funnels.length}`);
					for (const f of status.funnels) {
						cmdCtx.log.info(`    - ${f.publicUrl} -> localhost:${f.port}`);
					}
					return;
				}

				if (subcommand === "expose") {
					if (!portArg) {
						cmdCtx.log.error("Usage: wopr funnel expose <port>");
						return;
					}
					const port = parseInt(portArg, 10);
					if (Number.isNaN(port)) {
						cmdCtx.log.error("Invalid port number");
						return;
					}
					const url = await funnelExtension.expose(port);
					if (url) {
						cmdCtx.log.info(`Exposed: ${url} -> localhost:${port}`);
					} else {
						cmdCtx.log.error("Failed to expose port");
					}
					return;
				}

				if (subcommand === "unexpose") {
					if (!portArg) {
						cmdCtx.log.error("Usage: wopr funnel unexpose <port>");
						return;
					}
					const port = parseInt(portArg, 10);
					if (Number.isNaN(port)) {
						cmdCtx.log.error("Invalid port number");
						return;
					}
					const success = await funnelExtension.unexpose(port);
					if (success) {
						cmdCtx.log.info(`Stopped funnel for port ${port}`);
					} else {
						cmdCtx.log.error("Failed to stop funnel");
					}
					return;
				}

				cmdCtx.log.info("Usage: wopr funnel <status|expose|unexpose> [port]");
			},
		},
	],

	async init(pluginCtx) {
		ctx = pluginCtx;
		ctx.registerConfigSchema("wopr-plugin-tailscale-funnel", configSchema);
		const config = ctx.getConfig<FunnelConfig>();

		if (config?.enabled === false) {
			ctx.log.info("Tailscale Funnel plugin loaded (disabled)");
			return;
		}

		// Check availability first
		const isAvailable = await checkTailscaleAvailable();
		if (!isAvailable) {
			ctx.log.warn("Tailscale Funnel not available - install Tailscale and run 'tailscale up'");
			// Don't register extension if Tailscale isn't available
			return;
		}

		// Register extension only after confirming Tailscale is available
		ctx.registerExtension("funnel", funnelExtension);

		// Register WebMCP A2A tools (read-only)
		if (typeof ctx.registerA2AServer === "function") {
			ctx.registerA2AServer({
				name: "wopr-plugin-tailscale-funnel",
				version: "1.0.0",
				tools: [
					{
						name: "funnel_status",
						description:
							"Get Tailscale Funnel status: enabled/disabled, public URL, tailnet hostname.",
						inputSchema: { type: "object" as const, properties: {} },
						handler: async () => ({
							content: [
								{
									type: "text" as const,
									text: JSON.stringify(buildFunnelStatusResponse(funnelExtension.getStatus())),
								},
							],
						}),
					},
					{
						name: "funnel_routes",
						description: "Get active Tailscale Funnel routes and their target ports.",
						inputSchema: { type: "object" as const, properties: {} },
						handler: async () => ({
							content: [
								{
									type: "text" as const,
									text: JSON.stringify(buildFunnelRoutesResponse(funnelExtension.getStatus())),
								},
							],
						}),
					},
					{
						name: "tailscale_node_status",
						description: "Get Tailscale node status: online/offline, IP address, tailnet name.",
						inputSchema: { type: "object" as const, properties: {} },
						handler: async () => ({
							content: [
								{
									type: "text" as const,
									text: JSON.stringify(
										buildNodeStatusResponse(getTailscaleStatusJson(), available ?? false, hostname),
									),
								},
							],
						}),
					},
					{
						name: "funnel_stats",
						description: "Get Tailscale Funnel plugin statistics: funnels started/stopped, uptime.",
						inputSchema: { type: "object" as const, properties: {} },
						handler: async () => ({
							content: [
								{
									type: "text" as const,
									text: JSON.stringify(buildStatsResponse(getStats())),
								},
							],
						}),
					},
				],
			});
		}

		// Auto-expose configured port (only one supported by Tailscale)
		if (config?.expose) {
			// Support both old array format (use first item) and new object format
			const exposeConfig = Array.isArray(config.expose) ? config.expose[0] : config.expose;
			if (exposeConfig?.port) {
				const url = await startFunnel(exposeConfig.port, exposeConfig.path);
				if (url) {
					ctx.log.info(`Auto-exposed: ${url}`);
				}
			}
		}

		// Start hostname polling
		const pollSeconds = config?.pollIntervalSeconds ?? 60;
		if (pollSeconds > 0) {
			pollTimer = setInterval(() => {
				pollHostname().catch((err) => {
					ctx?.log.error(`Hostname poll error: ${err}`);
				});
			}, pollSeconds * 1000);
			ctx.log.debug?.(`Hostname polling every ${pollSeconds}s`);
		}

		ctx.log.info("Tailscale Funnel plugin initialized");
	},

	async shutdown() {
		// Stop hostname polling
		if (pollTimer) {
			clearInterval(pollTimer);
			pollTimer = null;
		}
		hostnameChangeCallbacks.length = 0;

		// Stop active funnel if any
		if (activeFunnel) {
			await stopFunnel(activeFunnel.port);
		}

		ctx?.unregisterConfigSchema("wopr-plugin-tailscale-funnel");
		ctx?.unregisterExtension("funnel");
		ctx = null;
		hostname = null;
		available = null;
		resetStats();
	},
};

export default plugin;
export type { FunnelExtension, FunnelStatus, FunnelInfo, HostnameChangeCallback };
