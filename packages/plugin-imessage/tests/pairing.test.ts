/**
 * Pairing system tests for wopr-plugin-imessage.
 *
 * Tests the pairing code generation, claiming, rate limiting,
 * and cleanup logic.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildPairingMessage,
  checkClaimRateLimit,
  claimPairingCode,
  cleanupExpiredPairings,
  createPairingRequest,
  getPairingRequest,
  listPairingRequests,
} from "../src/pairing.js";
import { createMockContext } from "./mocks/wopr-context.js";

// We need to clean up state between tests since pairing uses module-level Maps.
// cleanupExpiredPairings won't clear non-expired entries, so we use time mocking.
beforeEach(() => {
  vi.restoreAllMocks();
  // Force-expire all existing pairings by advancing time
  vi.useFakeTimers();
  vi.advanceTimersByTime(20 * 60 * 1000); // 20 minutes (past 15-minute TTL)
  cleanupExpiredPairings();
  vi.useRealTimers();
});

describe("createPairingRequest", () => {
  it("creates a pairing code for a handle", () => {
    const code = createPairingRequest("+1234567890");
    expect(code).toBeTruthy();
    expect(typeof code).toBe("string");
    expect(code.length).toBe(8);
  });

  it("returns same code for same handle (reuses pending)", () => {
    const code1 = createPairingRequest("+1234567890");
    const code2 = createPairingRequest("+1234567890");
    expect(code1).toBe(code2);
  });

  it("returns different codes for different handles", () => {
    const code1 = createPairingRequest("+1111111111");
    const code2 = createPairingRequest("+2222222222");
    expect(code1).not.toBe(code2);
  });

  it("code only contains non-ambiguous characters", () => {
    const allowed = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    for (let i = 0; i < 10; i++) {
      const code = createPairingRequest(`+${1000000000 + i}`);
      for (const ch of code) {
        expect(allowed).toContain(ch);
      }
    }
  });
});

describe("getPairingRequest", () => {
  it("retrieves a valid pending request", () => {
    const code = createPairingRequest("+1234567890");
    const request = getPairingRequest(code);
    expect(request).not.toBeNull();
    expect(request?.handle).toBe("+1234567890");
    expect(request?.code).toBe(code);
    expect(request?.claimed).toBe(false);
  });

  it("returns null for unknown code", () => {
    expect(getPairingRequest("ZZZZZZZZ")).toBeNull();
  });

  it("normalizes code to uppercase", () => {
    const code = createPairingRequest("+1234567890");
    const request = getPairingRequest(code.toLowerCase());
    expect(request).not.toBeNull();
  });

  it("trims whitespace from code", () => {
    const code = createPairingRequest("+1234567890");
    const request = getPairingRequest(`  ${code}  `);
    expect(request).not.toBeNull();
  });

  it("returns null for expired code", () => {
    const code = createPairingRequest("+1234567890");

    vi.useFakeTimers();
    vi.advanceTimersByTime(16 * 60 * 1000); // 16 minutes (past TTL)

    const request = getPairingRequest(code);
    expect(request).toBeNull();

    vi.useRealTimers();
  });
});

describe("buildPairingMessage", () => {
  it("includes the pairing code", () => {
    const message = buildPairingMessage("ABCD1234");
    expect(message).toContain("ABCD1234");
  });

  it("includes instructions for the user", () => {
    const message = buildPairingMessage("ABCD1234");
    expect(message).toContain("pairing code");
    expect(message).toContain("wopr imessage approve");
    expect(message).toContain("15 minutes");
  });

  it("is plain text (no markdown)", () => {
    const message = buildPairingMessage("ABCD1234");
    // Should not contain markdown formatting like ** or ``` or #
    expect(message).not.toContain("**");
    expect(message).not.toContain("```");
    expect(message).not.toMatch(/^#/m);
  });
});

describe("claimPairingCode", () => {
  it("claims a valid code and adds handle to allowlist", async () => {
    const code = createPairingRequest("+1234567890");
    const ctx = createMockContext();
    (ctx.getConfig as any).mockReturnValue({
      channels: { imessage: { allowFrom: [] } },
    });

    const result = await claimPairingCode(code, ctx);
    expect(result.handle).toBe("+1234567890");
    expect(result.error).toBeUndefined();

    // Should have saved config with handle in allowlist
    expect(ctx.saveConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        channels: expect.objectContaining({
          imessage: expect.objectContaining({
            allowFrom: expect.arrayContaining(["+1234567890"]),
          }),
        }),
      }),
    );
  });

  it("returns error for invalid code", async () => {
    const ctx = createMockContext();
    const result = await claimPairingCode("INVALID1", ctx);
    expect(result.handle).toBeNull();
    expect(result.error).toContain("Invalid");
  });

  it("returns error for already claimed code", async () => {
    const code = createPairingRequest("+1234567890");
    const ctx = createMockContext();
    (ctx.getConfig as any).mockReturnValue({
      channels: { imessage: { allowFrom: [] } },
    });

    // Claim once
    await claimPairingCode(code, ctx);

    // Claim again should fail
    const result = await claimPairingCode(code, ctx);
    expect(result.handle).toBeNull();
    expect(result.error).toBeTruthy();
  });

  it("returns error for expired code", async () => {
    const code = createPairingRequest("+1234567890");
    const ctx = createMockContext();

    vi.useFakeTimers();
    vi.advanceTimersByTime(16 * 60 * 1000);

    const result = await claimPairingCode(code, ctx);
    expect(result.handle).toBeNull();
    expect(result.error).toContain("expired");

    vi.useRealTimers();
  });

  it("does not duplicate handle in allowlist", async () => {
    const code = createPairingRequest("+1234567890");
    const ctx = createMockContext();
    (ctx.getConfig as any).mockReturnValue({
      channels: { imessage: { allowFrom: ["+1234567890"] } },
    });

    const result = await claimPairingCode(code, ctx);
    expect(result.handle).toBe("+1234567890");
    // saveConfig should NOT be called since handle is already in allowlist
    expect(ctx.saveConfig).not.toHaveBeenCalled();
  });
});

describe("checkClaimRateLimit", () => {
  it("allows first claim attempt", () => {
    expect(checkClaimRateLimit("source-1")).toBe(true);
  });

  it("allows up to 5 attempts per minute", () => {
    for (let i = 0; i < 5; i++) {
      expect(checkClaimRateLimit("source-rl")).toBe(true);
    }
  });

  it("blocks after 5 attempts in same window", () => {
    for (let i = 0; i < 5; i++) {
      checkClaimRateLimit("source-blocked");
    }
    expect(checkClaimRateLimit("source-blocked")).toBe(false);
  });

  it("resets after window expires", () => {
    for (let i = 0; i < 5; i++) {
      checkClaimRateLimit("source-reset");
    }
    expect(checkClaimRateLimit("source-reset")).toBe(false);

    vi.useFakeTimers();
    vi.advanceTimersByTime(61 * 1000); // Past 1-minute window

    expect(checkClaimRateLimit("source-reset")).toBe(true);

    vi.useRealTimers();
  });

  it("rate limits with sourceId in claimPairingCode", async () => {
    const ctx = createMockContext();
    (ctx.getConfig as any).mockReturnValue({
      channels: { imessage: { allowFrom: [] } },
    });

    // Exhaust rate limit
    for (let i = 0; i < 6; i++) {
      checkClaimRateLimit("cli-user");
    }

    const code = createPairingRequest("+9999999999");
    const result = await claimPairingCode(code, ctx, "cli-user");
    expect(result.handle).toBeNull();
    expect(result.error).toContain("Rate limited");
  });
});

describe("listPairingRequests", () => {
  it("returns empty array when no pairings exist", () => {
    expect(listPairingRequests()).toEqual([]);
  });

  it("returns active pairing requests", () => {
    createPairingRequest("+1111111111");
    createPairingRequest("+2222222222");

    const requests = listPairingRequests();
    expect(requests).toHaveLength(2);

    const handles = requests.map((r) => r.handle);
    expect(handles).toContain("+1111111111");
    expect(handles).toContain("+2222222222");
  });

  it("excludes expired requests", () => {
    createPairingRequest("+1111111111");

    vi.useFakeTimers();
    vi.advanceTimersByTime(16 * 60 * 1000);

    const requests = listPairingRequests();
    expect(requests).toHaveLength(0);

    vi.useRealTimers();
  });
});

describe("cleanupExpiredPairings", () => {
  it("removes expired pairings", () => {
    createPairingRequest("+1111111111");
    expect(listPairingRequests()).toHaveLength(1);

    vi.useFakeTimers();
    vi.advanceTimersByTime(16 * 60 * 1000);
    cleanupExpiredPairings();
    vi.useRealTimers();

    // After cleanup, getPairingRequest should also return null
    // (already covered, but this verifies cleanup removes from map)
    expect(listPairingRequests()).toHaveLength(0);
  });

  it("keeps non-expired pairings", () => {
    createPairingRequest("+1111111111");

    vi.useFakeTimers();
    vi.advanceTimersByTime(5 * 60 * 1000); // Only 5 minutes
    cleanupExpiredPairings();
    vi.useRealTimers();

    expect(listPairingRequests()).toHaveLength(1);
  });
});
