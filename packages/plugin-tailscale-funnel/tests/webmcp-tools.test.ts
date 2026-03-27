import { describe, expect, it } from "vitest";
import type { FunnelStats } from "../src/stats.js";
import type { FunnelStatus } from "../src/types.js";
import {
	buildFunnelRoutesResponse,
	buildFunnelStatusResponse,
	buildNodeStatusResponse,
	buildStatsResponse,
} from "../src/webmcp-tools.js";

describe("buildFunnelStatusResponse", () => {
	it("returns correct data with available=true and active funnel", () => {
		const status: FunnelStatus = {
			available: true,
			hostname: "wopr.tailnet.ts.net",
			funnels: [
				{
					port: 8080,
					path: "/",
					publicUrl: "https://wopr.tailnet.ts.net",
					active: true,
				},
			],
		};

		const result = buildFunnelStatusResponse(status);

		expect(result.available).toBe(true);
		expect(result.enabled).toBe(true);
		expect(result.hostname).toBe("wopr.tailnet.ts.net");
		expect(result.publicUrl).toBe("https://wopr.tailnet.ts.net");
		expect(result.activeFunnel).toEqual({
			port: 8080,
			path: "/",
			publicUrl: "https://wopr.tailnet.ts.net",
			active: true,
		});
	});

	it("returns correct data with available=false (no Tailscale)", () => {
		const status: FunnelStatus = {
			available: false,
			funnels: [],
		};

		const result = buildFunnelStatusResponse(status);

		expect(result.available).toBe(false);
		expect(result.enabled).toBe(false);
		expect(result.hostname).toBeNull();
		expect(result.publicUrl).toBeNull();
		expect(result.activeFunnel).toBeNull();
	});

	it("returns correct data with available=true but no active funnel", () => {
		const status: FunnelStatus = {
			available: true,
			hostname: "wopr.tailnet.ts.net",
			funnels: [],
		};

		const result = buildFunnelStatusResponse(status);

		expect(result.available).toBe(true);
		expect(result.enabled).toBe(false);
		expect(result.hostname).toBe("wopr.tailnet.ts.net");
		expect(result.publicUrl).toBeNull();
		expect(result.activeFunnel).toBeNull();
	});
});

describe("buildFunnelRoutesResponse", () => {
	it("returns routes with one active funnel", () => {
		const status: FunnelStatus = {
			available: true,
			hostname: "wopr.tailnet.ts.net",
			funnels: [
				{
					port: 3000,
					path: "/api",
					publicUrl: "https://wopr.tailnet.ts.net/api",
					active: true,
				},
			],
		};

		const result = buildFunnelRoutesResponse(status);

		expect(result.count).toBe(1);
		expect(result.routes).toEqual([
			{
				port: 3000,
				path: "/api",
				publicUrl: "https://wopr.tailnet.ts.net/api",
				active: true,
				target: "localhost:3000",
			},
		]);
	});

	it("returns empty routes with no funnels", () => {
		const status: FunnelStatus = {
			available: true,
			funnels: [],
		};

		const result = buildFunnelRoutesResponse(status);

		expect(result.count).toBe(0);
		expect(result.routes).toEqual([]);
	});

	it("includes target as localhost:<port>", () => {
		const status: FunnelStatus = {
			available: true,
			funnels: [
				{
					port: 9090,
					path: "/",
					publicUrl: "https://wopr.tailnet.ts.net",
					active: true,
				},
			],
		};

		const result = buildFunnelRoutesResponse(status);
		const routes = result.routes as Array<{ target: string }>;
		expect(routes[0].target).toBe("localhost:9090");
	});
});

describe("buildNodeStatusResponse", () => {
	const validTailscaleJson = JSON.stringify({
		BackendState: "Running",
		Self: {
			DNSName: "wopr.tailnet.ts.net.",
			TailscaleIPs: ["100.64.0.1", "fd7a:115c:a1e0::1"],
		},
		CurrentTailnet: {
			Name: "example.com",
		},
	});

	it("returns online node info with valid tailscale status JSON", () => {
		const result = buildNodeStatusResponse(validTailscaleJson, true, "wopr.tailnet.ts.net");

		expect(result.online).toBe(true);
		expect(result.available).toBe(true);
		expect(result.hostname).toBe("wopr.tailnet.ts.net");
		expect(result.ip).toBe("100.64.0.1");
		expect(result.tailnetName).toBe("example.com");
		expect(result.backendState).toBe("Running");
	});

	it("returns offline when JSON is null (Tailscale unavailable)", () => {
		const result = buildNodeStatusResponse(null, false, null);

		expect(result.online).toBe(false);
		expect(result.available).toBe(false);
		expect(result.hostname).toBeNull();
		expect(result.ip).toBeNull();
		expect(result.tailnetName).toBeNull();
	});

	it("returns fallback with invalid JSON (graceful degradation)", () => {
		const result = buildNodeStatusResponse("not-valid-json", true, "cached.host");

		expect(result.online).toBe(false);
		expect(result.available).toBe(true);
		expect(result.hostname).toBe("cached.host");
		expect(result.ip).toBeNull();
		expect(result.tailnetName).toBeNull();
	});

	it("does NOT contain AuthKey, AuthURL, or any auth fields", () => {
		const jsonWithAuth = JSON.stringify({
			BackendState: "Running",
			AuthURL: "https://login.tailscale.com/a/abc123",
			Self: {
				DNSName: "wopr.tailnet.ts.net.",
				TailscaleIPs: ["100.64.0.1"],
				AuthKey: "tskey-auth-secret123",
			},
			CurrentTailnet: {
				Name: "example.com",
			},
		});

		const result = buildNodeStatusResponse(jsonWithAuth, true, null);
		const json = JSON.stringify(result);

		expect(json).not.toContain("AuthKey");
		expect(json).not.toContain("AuthURL");
		expect(json).not.toContain("tskey-auth-secret123");
		expect(json).not.toContain("login.tailscale.com");
	});
});

describe("buildStatsResponse", () => {
	it("returns correct uptime calculation", () => {
		const startedAt = Date.now() - 60000; // 60 seconds ago
		const stats: FunnelStats = {
			funnelsStarted: 2,
			funnelsStopped: 1,
			hostnameChanges: 0,
			statusChecks: 5,
			startedAt,
		};

		const result = buildStatsResponse(stats);
		const uptime = result.uptime as {
			ms: number;
			seconds: number;
			human: string;
			startedAt: string;
		};

		expect(uptime.ms).toBeGreaterThanOrEqual(59000);
		expect(uptime.seconds).toBeGreaterThanOrEqual(59);
		expect(uptime.human).toMatch(/^\d+m \d+s$/);
		expect(uptime.startedAt).toBe(new Date(startedAt).toISOString());
	});

	it("returns zero counters initially", () => {
		const stats: FunnelStats = {
			funnelsStarted: 0,
			funnelsStopped: 0,
			hostnameChanges: 0,
			statusChecks: 0,
			startedAt: Date.now(),
		};

		const result = buildStatsResponse(stats);
		const funnels = result.funnels as { started: number; stopped: number };

		expect(funnels.started).toBe(0);
		expect(funnels.stopped).toBe(0);
		expect(result.hostnameChanges).toBe(0);
		expect(result.statusChecks).toBe(0);
	});
});
