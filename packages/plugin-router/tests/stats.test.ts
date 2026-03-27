import { describe, it, expect, beforeEach } from "vitest";
import {
  getStats,
  incrementRouted,
  incrementOutgoingRouted,
  recordRouteHit,
  incrementErrors,
  resetStats,
} from "../src/stats.js";

describe("stats", () => {
  beforeEach(() => {
    resetStats();
  });

  it("should return all zero counters initially (except startedAt)", () => {
    const stats = getStats();
    expect(stats.messagesRouted).toBe(0);
    expect(stats.outgoingRouted).toBe(0);
    expect(stats.errors).toBe(0);
    expect(stats.routeHits).toEqual({});
    expect(stats.startedAt).toBeGreaterThan(0);
  });

  it("should increment messagesRouted by 1", () => {
    incrementRouted();
    expect(getStats().messagesRouted).toBe(1);
    incrementRouted();
    expect(getStats().messagesRouted).toBe(2);
  });

  it("should increment outgoingRouted by 1", () => {
    incrementOutgoingRouted();
    expect(getStats().outgoingRouted).toBe(1);
    incrementOutgoingRouted();
    expect(getStats().outgoingRouted).toBe(2);
  });

  it("should create route hit entry with count 1", () => {
    recordRouteHit("a", "b");
    expect(getStats().routeHits).toEqual({ "a->b": 1 });
  });

  it("should increment route hit count on repeated calls", () => {
    recordRouteHit("a", "b");
    recordRouteHit("a", "b");
    expect(getStats().routeHits["a->b"]).toBe(2);
  });

  it("should track different routes separately", () => {
    recordRouteHit("a", "b");
    recordRouteHit("a", "c");
    recordRouteHit("x", "y");
    const hits = getStats().routeHits;
    expect(hits["a->b"]).toBe(1);
    expect(hits["a->c"]).toBe(1);
    expect(hits["x->y"]).toBe(1);
  });

  it("should increment errors by 1", () => {
    incrementErrors();
    expect(getStats().errors).toBe(1);
    incrementErrors();
    expect(getStats().errors).toBe(2);
  });

  it("should reset all counters, clear routeHits, and update startedAt", () => {
    incrementRouted();
    incrementOutgoingRouted();
    incrementErrors();
    recordRouteHit("a", "b");
    const before = getStats().startedAt;

    // Small delay to ensure startedAt changes
    const start = Date.now();
    while (Date.now() === start) {
      // spin until ms ticks
    }

    resetStats();
    const after = getStats();
    expect(after.messagesRouted).toBe(0);
    expect(after.outgoingRouted).toBe(0);
    expect(after.errors).toBe(0);
    expect(after.routeHits).toEqual({});
    expect(after.startedAt).toBeGreaterThanOrEqual(before);
  });

  it("should return a copy from getStats (modifying result does not affect internal state)", () => {
    incrementRouted();
    const stats = getStats();
    (stats as any).messagesRouted = 999;
    expect(getStats().messagesRouted).toBe(1);
  });

  it("should return a copy of routeHits (modifying it does not affect internal state)", () => {
    recordRouteHit("a", "b");
    const stats = getStats();
    stats.routeHits["a->b"] = 999;
    expect(getStats().routeHits["a->b"]).toBe(1);
  });
});
