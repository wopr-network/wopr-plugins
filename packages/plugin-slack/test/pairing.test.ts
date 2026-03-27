import { describe, it, expect, beforeEach, vi } from "vitest";
import {
	createPairingRequest,
	claimPairingCode,
	checkRequestRateLimit,
	checkClaimRateLimit,
	cleanupExpiredPairings,
	buildPairingMessage,
	getPairingRequest,
	listPairingRequests,
	isUserAllowed,
	approveUser,
} from "../src/pairing.js";
import type { WOPRPluginContext } from "../src/types.js";

/**
 * Build a mock WOPRPluginContext with optional config overrides.
 */
function mockContext(
	config: Record<string, any> = {},
): WOPRPluginContext {
	let storedConfig = structuredClone(config);
	return {
		inject: vi.fn(),
		logMessage: vi.fn(),
		injectPeer: vi.fn(),
		getIdentity: () => ({ publicKey: "pk", shortId: "id", encryptPub: "ep" }),
		getAgentIdentity: () => ({ name: "WOPR", emoji: "👀" }),
		getUserProfile: () => ({}),
		getSessions: () => [],
		getPeers: () => [],
		getConfig: () => storedConfig as any,
		saveConfig: vi.fn(async (c: any) => {
			storedConfig = c;
		}),
		getMainConfig: () => ({}),
		registerConfigSchema: vi.fn(),
		getPluginDir: () => "/tmp",
		log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
	};
}

describe("pairing", () => {
	// Reset module-level state between tests by re-importing would be ideal,
	// but since the maps are internal we rely on cleanup + unique user IDs.

	describe("createPairingRequest", () => {
		it("returns an 8-character uppercase code", () => {
			const code = createPairingRequest("U_CREATE_1", "alice");
			expect(code).toMatch(/^[A-Z2-9]{8}$/);
		});

		it("returns the same code for the same user (refresh)", () => {
			const code1 = createPairingRequest("U_CREATE_2", "bob");
			const code2 = createPairingRequest("U_CREATE_2", "bob");
			expect(code1).toBe(code2);
		});

		it("returns different codes for different users", () => {
			const code1 = createPairingRequest("U_CREATE_3", "carol");
			const code2 = createPairingRequest("U_CREATE_4", "dave");
			expect(code1).not.toBe(code2);
		});
	});

	describe("claimPairingCode", () => {
		it("claims a valid code successfully", () => {
			const code = createPairingRequest("U_CLAIM_1", "eve");
			const result = claimPairingCode(code, "source1", "U_CLAIM_1");
			expect(result.request).not.toBeNull();
			expect(result.request!.slackUserId).toBe("U_CLAIM_1");
			expect(result.request!.claimed).toBe(true);
			expect(result.error).toBeUndefined();
		});

		it("returns error for invalid code", () => {
			const result = claimPairingCode("ZZZZZZZZ", "source2");
			expect(result.request).toBeNull();
			expect(result.error).toBe("Invalid or expired pairing code");
		});

		it("returns error when code is claimed by wrong user", () => {
			const code = createPairingRequest("U_CLAIM_2", "frank");
			const result = claimPairingCode(code, "source3", "U_WRONG");
			expect(result.request).toBeNull();
			expect(result.error).toBe(
				"This pairing code was not generated for your account",
			);
		});

		it("returns error when code is already claimed", () => {
			const code = createPairingRequest("U_CLAIM_3", "grace");
			claimPairingCode(code, "source4", "U_CLAIM_3");
			const result = claimPairingCode(code, "source5", "U_CLAIM_3");
			// Code was deleted after first claim, so it's "invalid or expired"
			expect(result.request).toBeNull();
			expect(result.error).toBeDefined();
		});

		it("normalizes code to uppercase and trims whitespace", () => {
			const code = createPairingRequest("U_CLAIM_4", "heidi");
			const result = claimPairingCode(
				`  ${code.toLowerCase()}  `,
				"source6",
				"U_CLAIM_4",
			);
			expect(result.request).not.toBeNull();
		});

		it("returns error for expired code", () => {
			const code = createPairingRequest("U_CLAIM_5", "ivan");
			// Advance time past TTL (15 minutes)
			vi.useFakeTimers();
			vi.advanceTimersByTime(16 * 60 * 1000);
			const result = claimPairingCode(code, "source7", "U_CLAIM_5");
			expect(result.request).toBeNull();
			expect(result.error).toBe("Pairing code has expired");
			vi.useRealTimers();
		});
	});

	describe("checkClaimRateLimit", () => {
		it("allows first attempt", () => {
			expect(checkClaimRateLimit("rl_claim_1")).toBe(true);
		});

		it("allows up to 5 attempts in a window", () => {
			const id = "rl_claim_2";
			for (let i = 0; i < 5; i++) {
				expect(checkClaimRateLimit(id)).toBe(true);
			}
		});

		it("blocks the 6th attempt", () => {
			const id = "rl_claim_3";
			for (let i = 0; i < 5; i++) {
				checkClaimRateLimit(id);
			}
			expect(checkClaimRateLimit(id)).toBe(false);
		});

		it("resets after the window expires", () => {
			const id = "rl_claim_4";
			for (let i = 0; i < 5; i++) {
				checkClaimRateLimit(id);
			}
			expect(checkClaimRateLimit(id)).toBe(false);
			// Advance past 1-minute window
			vi.useFakeTimers();
			vi.advanceTimersByTime(61 * 1000);
			expect(checkClaimRateLimit(id)).toBe(true);
			vi.useRealTimers();
		});
	});

	describe("checkRequestRateLimit", () => {
		it("allows first request", () => {
			expect(checkRequestRateLimit("rl_req_1")).toBe(true);
		});

		it("allows up to 3 requests in a window", () => {
			const id = "rl_req_2";
			for (let i = 0; i < 3; i++) {
				expect(checkRequestRateLimit(id)).toBe(true);
			}
		});

		it("blocks the 4th request", () => {
			const id = "rl_req_3";
			for (let i = 0; i < 3; i++) {
				checkRequestRateLimit(id);
			}
			expect(checkRequestRateLimit(id)).toBe(false);
		});

		it("resets after the window expires", () => {
			const id = "rl_req_4";
			for (let i = 0; i < 3; i++) {
				checkRequestRateLimit(id);
			}
			expect(checkRequestRateLimit(id)).toBe(false);
			vi.useFakeTimers();
			vi.advanceTimersByTime(5 * 60 * 1000 + 1000);
			expect(checkRequestRateLimit(id)).toBe(true);
			vi.useRealTimers();
		});
	});

	describe("getPairingRequest", () => {
		it("returns a pending request by code", () => {
			const code = createPairingRequest("U_GET_1", "judy");
			const request = getPairingRequest(code);
			expect(request).not.toBeNull();
			expect(request!.slackUserId).toBe("U_GET_1");
			expect(request!.slackUsername).toBe("judy");
		});

		it("returns null for unknown code", () => {
			expect(getPairingRequest("XXXXXXXX")).toBeNull();
		});

		it("normalizes code input", () => {
			const code = createPairingRequest("U_GET_2", "karl");
			const request = getPairingRequest(`  ${code.toLowerCase()}  `);
			expect(request).not.toBeNull();
		});

		it("returns null for expired code", () => {
			const code = createPairingRequest("U_GET_3", "liam");
			vi.useFakeTimers();
			vi.advanceTimersByTime(16 * 60 * 1000);
			expect(getPairingRequest(code)).toBeNull();
			vi.useRealTimers();
		});
	});

	describe("listPairingRequests", () => {
		it("returns array of pending requests", () => {
			createPairingRequest("U_LIST_1", "mike");
			const list = listPairingRequests();
			expect(Array.isArray(list)).toBe(true);
			const found = list.find((r) => r.slackUserId === "U_LIST_1");
			expect(found).toBeDefined();
		});
	});

	describe("cleanupExpiredPairings", () => {
		it("removes expired pairings without throwing", () => {
			createPairingRequest("U_CLEAN_1", "nina");
			// Should not throw even with active pairings
			expect(() => cleanupExpiredPairings()).not.toThrow();
		});

		it("cleans up expired entries after TTL", () => {
			const code = createPairingRequest("U_CLEAN_2", "otto");
			vi.useFakeTimers();
			vi.advanceTimersByTime(16 * 60 * 1000);
			cleanupExpiredPairings();
			expect(getPairingRequest(code)).toBeNull();
			vi.useRealTimers();
		});
	});

	describe("buildPairingMessage", () => {
		it("includes the pairing code", () => {
			const msg = buildPairingMessage("ABCD1234");
			expect(msg).toContain("ABCD1234");
		});

		it("includes the claim command", () => {
			const msg = buildPairingMessage("ABCD1234");
			expect(msg).toContain("wopr slack claim ABCD1234");
		});

		it("includes expiration notice", () => {
			const msg = buildPairingMessage("ABCD1234");
			expect(msg).toContain("15 minutes");
		});

		it("uses Slack mrkdwn formatting", () => {
			const msg = buildPairingMessage("ABCD1234");
			expect(msg).toContain("*Pairing Required*");
			expect(msg).toContain("```");
		});
	});

	describe("isUserAllowed", () => {
		it("returns false when allowFrom is empty", () => {
			const ctx = mockContext({
				channels: { slack: { dm: { allowFrom: [] } } },
			});
			expect(isUserAllowed(ctx, "U123")).toBe(false);
		});

		it("returns true when user is in allowFrom", () => {
			const ctx = mockContext({
				channels: { slack: { dm: { allowFrom: ["U123", "U456"] } } },
			});
			expect(isUserAllowed(ctx, "U123")).toBe(true);
		});

		it("returns false when user is not in allowFrom", () => {
			const ctx = mockContext({
				channels: { slack: { dm: { allowFrom: ["U456"] } } },
			});
			expect(isUserAllowed(ctx, "U123")).toBe(false);
		});

		it("returns true when wildcard * is in allowFrom", () => {
			const ctx = mockContext({
				channels: { slack: { dm: { allowFrom: ["*"] } } },
			});
			expect(isUserAllowed(ctx, "U_ANYONE")).toBe(true);
		});

		it("returns false when config structure is missing", () => {
			const ctx = mockContext({});
			expect(isUserAllowed(ctx, "U123")).toBe(false);
		});
	});

	describe("approveUser", () => {
		it("adds user to allowFrom and saves config", async () => {
			const ctx = mockContext({});
			await approveUser(ctx, "U_APPROVE_1");
			expect(ctx.saveConfig).toHaveBeenCalled();
			// After approval, user should be allowed
			expect(isUserAllowed(ctx, "U_APPROVE_1")).toBe(true);
		});

		it("does not duplicate an already-approved user", async () => {
			const ctx = mockContext({
				channels: { slack: { dm: { allowFrom: ["U_APPROVE_2"] } } },
			});
			await approveUser(ctx, "U_APPROVE_2");
			expect(ctx.saveConfig).not.toHaveBeenCalled();
		});

		it("creates nested config structure if missing", async () => {
			const ctx = mockContext({});
			await approveUser(ctx, "U_APPROVE_3");
			const config = ctx.getConfig<any>();
			expect(config.channels.slack.dm.allowFrom).toContain("U_APPROVE_3");
		});

		it("throws when saveConfig fails", async () => {
			const ctx = mockContext({});
			(ctx.saveConfig as any).mockRejectedValueOnce(new Error("disk full"));
			await expect(approveUser(ctx, "U_APPROVE_4")).rejects.toThrow(
				"Failed to save config",
			);
		});
	});
});
