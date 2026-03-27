import { describe, it, expect } from "vitest";
import {
  buildRouterStatusResponse,
  buildListRoutesResponse,
  buildRoutingStatsResponse,
} from "../src/webmcp-tools.js";
import type { RoutingStats } from "../src/stats.js";

describe("buildRouterStatusResponse", () => {
  it("should return status with routes configured and server running", () => {
    const config = {
      routes: [
        { sourceSession: "a", targetSessions: ["b"] },
        { sourceSession: "c", targetSessions: ["d"] },
      ],
      outgoingRoutes: [{ sourceSession: "a", channelType: "discord" }],
    };
    const result = buildRouterStatusResponse(config, true);
    expect(result.enabled).toBe(true);
    expect(result.totalRoutes).toBe(3);
    expect((result.incoming as any).count).toBe(2);
    expect((result.outgoing as any).count).toBe(1);
  });

  it("should return totalRoutes 0 with no routes and server running", () => {
    const result = buildRouterStatusResponse({ routes: [], outgoingRoutes: [] }, true);
    expect(result.enabled).toBe(true);
    expect(result.totalRoutes).toBe(0);
  });

  it("should return enabled false when server not running", () => {
    const result = buildRouterStatusResponse({}, false);
    expect(result.enabled).toBe(false);
  });

  it("should handle undefined routes and outgoingRoutes", () => {
    const result = buildRouterStatusResponse({}, true);
    expect(result.totalRoutes).toBe(0);
    expect((result.incoming as any).count).toBe(0);
    expect((result.outgoing as any).count).toBe(0);
  });
});

describe("buildListRoutesResponse", () => {
  it("should list incoming and outgoing routes", () => {
    const config = {
      routes: [
        { sourceSession: "session-a", targetSessions: ["session-b", "session-c"], channelType: "discord" },
      ],
      outgoingRoutes: [
        { sourceSession: "session-a", channelType: "discord", channelId: "ch1" },
      ],
    };
    const result = buildListRoutesResponse(config);
    const incoming = result.incoming as any[];
    const outgoing = result.outgoing as any[];

    expect(incoming).toHaveLength(1);
    expect(incoming[0].source).toBe("session-a");
    expect(incoming[0].targets).toEqual(["session-b", "session-c"]);
    expect(incoming[0].channelType).toBe("discord");

    expect(outgoing).toHaveLength(1);
    expect(outgoing[0].source).toBe("session-a");
    expect(outgoing[0].channelType).toBe("discord");
    expect(outgoing[0].channelId).toBe("ch1");

    expect(result.totalRules).toBe(2);
  });

  it("should return empty arrays with empty config", () => {
    const result = buildListRoutesResponse({ routes: [], outgoingRoutes: [] });
    expect(result.incoming).toEqual([]);
    expect(result.outgoing).toEqual([]);
    expect(result.totalRules).toBe(0);
  });

  it("should format incoming summary as 'source -> targets'", () => {
    const config = {
      routes: [{ sourceSession: "a", targetSessions: ["b", "c"] }],
    };
    const result = buildListRoutesResponse(config);
    const incoming = result.incoming as any[];
    expect(incoming[0].summary).toBe("a -> b, c");
  });

  it("should use wildcard '*' when sourceSession is undefined", () => {
    const config = {
      routes: [{ targetSessions: ["b"] }],
    };
    const result = buildListRoutesResponse(config);
    const incoming = result.incoming as any[];
    expect(incoming[0].source).toBe("*");
    expect(incoming[0].summary).toContain("* -> b");
  });

  it("should include channelType in incoming summary when present", () => {
    const config = {
      routes: [{ sourceSession: "a", targetSessions: ["b"], channelType: "discord" }],
    };
    const result = buildListRoutesResponse(config);
    const incoming = result.incoming as any[];
    expect(incoming[0].summary).toBe("a -> b [discord]");
  });

  it("should include channelId in outgoing summary when present", () => {
    const config = {
      outgoingRoutes: [{ sourceSession: "a", channelId: "general" }],
    };
    const result = buildListRoutesResponse(config);
    const outgoing = result.outgoing as any[];
    expect(outgoing[0].summary).toContain("#general");
  });

  it("should format outgoing summary with channelType", () => {
    const config = {
      outgoingRoutes: [{ sourceSession: "a", channelType: "discord" }],
    };
    const result = buildListRoutesResponse(config);
    const outgoing = result.outgoing as any[];
    expect(outgoing[0].summary).toBe("a -> channels [discord]");
  });

  it("should handle routes with no targetSessions", () => {
    const config = {
      routes: [{ sourceSession: "a" }],
    };
    const result = buildListRoutesResponse(config);
    const incoming = result.incoming as any[];
    expect(incoming[0].targets).toEqual([]);
    expect(incoming[0].summary).toBe("a -> (none)");
  });
});

describe("buildRoutingStatsResponse", () => {
  const baseStats: RoutingStats = {
    messagesRouted: 0,
    routeHits: {},
    errors: 0,
    outgoingRouted: 0,
    startedAt: Date.now(),
  };

  it("should return zero stats", () => {
    const result = buildRoutingStatsResponse(baseStats);
    const messages = result.messages as any;
    expect(messages.routed).toBe(0);
    expect(messages.outgoingRouted).toBe(0);
    expect(messages.total).toBe(0);
    expect(messages.errors).toBe(0);
    expect(result.routeHits).toEqual([]);
  });

  it("should show correct message totals with populated stats", () => {
    const stats: RoutingStats = {
      messagesRouted: 10,
      outgoingRouted: 5,
      errors: 2,
      routeHits: { "a->b": 7, "a->c": 3 },
      startedAt: Date.now() - 60000,
    };
    const result = buildRoutingStatsResponse(stats);
    const messages = result.messages as any;
    expect(messages.routed).toBe(10);
    expect(messages.outgoingRouted).toBe(5);
    expect(messages.total).toBe(15);
    expect(messages.errors).toBe(2);
  });

  it("should format routeHits as array of {route, count}", () => {
    const stats: RoutingStats = {
      ...baseStats,
      routeHits: { "a->b": 5, "c->d": 3 },
    };
    const result = buildRoutingStatsResponse(stats);
    const hits = result.routeHits as any[];
    expect(hits).toHaveLength(2);
    expect(hits).toContainEqual({ route: "a->b", count: 5 });
    expect(hits).toContainEqual({ route: "c->d", count: 3 });
  });

  it("should calculate uptime correctly", () => {
    const stats: RoutingStats = {
      ...baseStats,
      startedAt: Date.now() - 5000, // 5 seconds ago
    };
    const result = buildRoutingStatsResponse(stats);
    const uptime = result.uptime as any;
    expect(uptime.seconds).toBeGreaterThanOrEqual(4);
    expect(uptime.seconds).toBeLessThanOrEqual(6);
    expect(uptime.ms).toBeGreaterThanOrEqual(4000);
    expect(uptime.startedAt).toBeDefined();
  });

  it("should produce correct human-readable uptime for seconds", () => {
    const stats: RoutingStats = {
      ...baseStats,
      startedAt: Date.now() - 30000, // 30 seconds
    };
    const result = buildRoutingStatsResponse(stats);
    const uptime = result.uptime as any;
    expect(uptime.human).toMatch(/^\d+s$/);
  });

  it("should produce correct human-readable uptime for minutes", () => {
    const stats: RoutingStats = {
      ...baseStats,
      startedAt: Date.now() - 150000, // 2.5 minutes
    };
    const result = buildRoutingStatsResponse(stats);
    const uptime = result.uptime as any;
    expect(uptime.human).toMatch(/^\d+m \d+s$/);
  });

  it("should produce correct human-readable uptime for hours", () => {
    const stats: RoutingStats = {
      ...baseStats,
      startedAt: Date.now() - 7200000, // 2 hours
    };
    const result = buildRoutingStatsResponse(stats);
    const uptime = result.uptime as any;
    expect(uptime.human).toMatch(/^\d+h \d+m$/);
  });

  it("should produce correct human-readable uptime for days", () => {
    const stats: RoutingStats = {
      ...baseStats,
      startedAt: Date.now() - 90000000, // ~1 day
    };
    const result = buildRoutingStatsResponse(stats);
    const uptime = result.uptime as any;
    expect(uptime.human).toMatch(/^\d+d \d+h$/);
  });
});
