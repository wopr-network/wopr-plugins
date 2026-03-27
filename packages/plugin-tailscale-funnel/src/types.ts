/**
 * Tailscale Funnel Plugin Types
 *
 * Shared WOPR types are imported from @wopr-network/plugin-types.
 * Only plugin-specific types are defined here.
 */

export type {
	ConfigSchema,
	WOPRPlugin,
	WOPRPluginContext,
} from "@wopr-network/plugin-types";

export interface FunnelConfig {
	enabled?: boolean;
	/**
	 * Auto-expose this port on init.
	 * Note: Tailscale Funnel only supports ONE port at a time.
	 * Also accepts array for backwards compatibility (only first item used).
	 */
	expose?: FunnelExpose | FunnelExpose[];
	/**
	 * How often (in seconds) to poll `tailscale status --json` for hostname
	 * changes. Set to 0 to disable polling. Default: 60.
	 */
	pollIntervalSeconds?: number;
}

export interface FunnelExpose {
	/** Local port to expose */
	port: number;
	/** Optional path prefix (default: /) */
	path?: string;
}

export interface FunnelStatus {
	available: boolean;
	hostname?: string;
	funnels: FunnelInfo[];
}

export interface FunnelInfo {
	port: number;
	path: string;
	publicUrl: string;
	active: boolean;
}

/** Callback for hostname change notifications */
export type HostnameChangeCallback = (oldHostname: string, newHostname: string) => void;

/**
 * Extension interface exposed to other plugins
 */
export interface FunnelExtension {
	/** Check if Tailscale Funnel is available */
	isAvailable(): Promise<boolean>;

	/** Get the Tailscale hostname (e.g., wopr.tailnet.ts.net) */
	getHostname(): Promise<string | null>;

	/** Expose a local port via funnel, returns public URL */
	expose(port: number, path?: string): Promise<string | null>;

	/** Stop exposing a port */
	unexpose(port: number): Promise<boolean>;

	/** Get public URL for an exposed port */
	getUrl(port: number): string | null;

	/** Get status of all funnels */
	getStatus(): FunnelStatus;

	/** Register a callback for hostname changes (alternative to event bus) */
	onHostnameChange(callback: HostnameChangeCallback): void;

	/** Get the active funnel port, or null if no funnel is active */
	getPort(): number | null;
}
