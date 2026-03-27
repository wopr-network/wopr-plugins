// src/stats.ts

export interface RoutingStats {
	messagesRouted: number;
	routeHits: Record<string, number>; // key: "sourceSession->targetSession", value: hit count
	errors: number;
	outgoingRouted: number;
	startedAt: number;
}

let stats: RoutingStats = {
	messagesRouted: 0,
	routeHits: {},
	errors: 0,
	outgoingRouted: 0,
	startedAt: Date.now(),
};

export function getStats(): Readonly<RoutingStats> {
	return {
		messagesRouted: stats.messagesRouted,
		routeHits: { ...stats.routeHits },
		errors: stats.errors,
		outgoingRouted: stats.outgoingRouted,
		startedAt: stats.startedAt,
	};
}

export function incrementRouted(): void {
	stats.messagesRouted++;
}

export function incrementOutgoingRouted(): void {
	stats.outgoingRouted++;
}

export function recordRouteHit(source: string, target: string): void {
	const key = `${source}->${target}`;
	stats.routeHits[key] = (stats.routeHits[key] || 0) + 1;
}

export function incrementErrors(): void {
	stats.errors++;
}

export function resetStats(): void {
	stats = {
		messagesRouted: 0,
		routeHits: {},
		errors: 0,
		outgoingRouted: 0,
		startedAt: Date.now(),
	};
}
