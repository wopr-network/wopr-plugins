import { beforeEach, describe, expect, it } from "vitest";
import { getStats, incrementStat, resetStats } from "../src/stats.js";

describe("stats", () => {
	beforeEach(() => {
		resetStats();
	});

	it("returns all zero counters initially (except startedAt)", () => {
		const stats = getStats();
		expect(stats.funnelsStarted).toBe(0);
		expect(stats.funnelsStopped).toBe(0);
		expect(stats.hostnameChanges).toBe(0);
		expect(stats.statusChecks).toBe(0);
		expect(stats.startedAt).toBeGreaterThan(0);
	});

	it("incrementStat increments correctly", () => {
		incrementStat("funnelsStarted");
		incrementStat("funnelsStarted");
		expect(getStats().funnelsStarted).toBe(2);
	});

	it("incrementStat increments by custom amount", () => {
		incrementStat("statusChecks", 5);
		expect(getStats().statusChecks).toBe(5);
	});

	it("resetStats resets all counters and updates startedAt", () => {
		incrementStat("funnelsStarted", 3);
		incrementStat("funnelsStopped", 2);
		incrementStat("hostnameChanges", 1);
		incrementStat("statusChecks", 10);

		const beforeReset = getStats().startedAt;
		resetStats();

		const stats = getStats();
		expect(stats.funnelsStarted).toBe(0);
		expect(stats.funnelsStopped).toBe(0);
		expect(stats.hostnameChanges).toBe(0);
		expect(stats.statusChecks).toBe(0);
		expect(stats.startedAt).toBeGreaterThanOrEqual(beforeReset);
	});

	it("modifying result of getStats does not affect internal state", () => {
		incrementStat("funnelsStarted", 5);
		const result = getStats();
		(result as { funnelsStarted: number }).funnelsStarted = 999;

		expect(getStats().funnelsStarted).toBe(5);
	});
});
