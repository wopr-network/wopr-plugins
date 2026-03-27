// src/stats.ts

export interface FunnelStats {
	funnelsStarted: number;
	funnelsStopped: number;
	hostnameChanges: number;
	statusChecks: number;
	startedAt: number;
}

let stats: FunnelStats = {
	funnelsStarted: 0,
	funnelsStopped: 0,
	hostnameChanges: 0,
	statusChecks: 0,
	startedAt: Date.now(),
};

export function getStats(): Readonly<FunnelStats> {
	return { ...stats };
}

export function incrementStat(key: keyof Omit<FunnelStats, "startedAt">, amount = 1): void {
	stats[key] += amount;
}

export function resetStats(): void {
	stats = {
		funnelsStarted: 0,
		funnelsStopped: 0,
		hostnameChanges: 0,
		statusChecks: 0,
		startedAt: Date.now(),
	};
}
