/**
 * Slack Owner Pairing
 *
 * Allows users to prove they have access to a shared secret before
 * the bot accepts their DMs. The user DMs the bot, receives a pairing
 * code, then runs `wopr slack claim <code>` to approve themselves.
 *
 * Follows the pattern established in wopr-plugin-discord/src/pairing.ts.
 */

import crypto from "node:crypto";
import type { WOPRPluginContext } from "./types.js";

// Pairing code settings
const PAIRING_CODE_LENGTH = 8;
const PAIRING_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // No ambiguous chars
const PAIRING_CODE_TTL_MS = 15 * 60 * 1000; // 15 minutes

// Rate limiting for claim attempts
const CLAIM_RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute window
const CLAIM_RATE_LIMIT_MAX_ATTEMPTS = 5; // max 5 attempts per window

// Rate limiting for pairing requests (prevent spam)
const REQUEST_RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000; // 5 minute window
const REQUEST_RATE_LIMIT_MAX = 3; // max 3 requests per window

interface RateWindow {
  count: number;
  windowStart: number;
}

// Track claim attempts by source identifier
const claimAttempts: Map<string, RateWindow> = new Map();

// Track pairing request rate per user
const requestAttempts: Map<string, RateWindow> = new Map();

/**
 * Pending pairing request
 */
export interface PairingRequest {
  code: string;
  slackUserId: string;
  slackUsername: string;
  createdAt: number;
  claimed: boolean;
}

// In-memory store for pending pairing requests
const pendingPairings: Map<string, PairingRequest> = new Map();

/**
 * Generate a random pairing code
 */
function generateCode(): string {
  let code = "";
  for (let i = 0; i < PAIRING_CODE_LENGTH; i++) {
    const idx = crypto.randomInt(0, PAIRING_CODE_ALPHABET.length);
    code += PAIRING_CODE_ALPHABET[idx];
  }
  return code;
}

/**
 * Generate a unique pairing code
 */
function generateUniqueCode(): string {
  for (let attempt = 0; attempt < 100; attempt++) {
    const code = generateCode();
    // Check the live map directly to avoid race conditions with a stale snapshot
    if (!pendingPairings.has(code)) {
      return code;
    }
  }
  throw new Error("Failed to generate unique pairing code");
}

/**
 * Check if a request source is rate-limited for pairing requests.
 * Returns true if the request is allowed, false if rate-limited.
 */
export function checkRequestRateLimit(userId: string): boolean {
  const now = Date.now();
  const attempt = requestAttempts.get(userId);

  if (!attempt || now - attempt.windowStart > REQUEST_RATE_LIMIT_WINDOW_MS) {
    requestAttempts.set(userId, { count: 1, windowStart: now });
    return true;
  }

  if (attempt.count >= REQUEST_RATE_LIMIT_MAX) {
    return false;
  }
  attempt.count++;
  return true;
}

/**
 * Create a pairing request for a Slack user
 */
export function createPairingRequest(slackUserId: string, slackUsername: string): string {
  // Check if there's already a pending request for this user
  for (const [, request] of pendingPairings) {
    if (request.slackUserId === slackUserId) {
      // Refresh the existing request
      request.createdAt = Date.now();
      return request.code;
    }
  }

  // Create new pairing request
  const code = generateUniqueCode();
  pendingPairings.set(code, {
    code,
    slackUserId,
    slackUsername,
    createdAt: Date.now(),
    claimed: false,
  });

  return code;
}

/**
 * Check if a claim source is rate-limited.
 * Returns true if the attempt is allowed, false if rate-limited.
 */
export function checkClaimRateLimit(sourceId: string): boolean {
  const now = Date.now();
  const attempt = claimAttempts.get(sourceId);

  if (!attempt || now - attempt.windowStart > CLAIM_RATE_LIMIT_WINDOW_MS) {
    claimAttempts.set(sourceId, { count: 1, windowStart: now });
    return true;
  }

  if (attempt.count >= CLAIM_RATE_LIMIT_MAX_ATTEMPTS) {
    return false;
  }
  attempt.count++;
  return true;
}

/**
 * Claim a pairing code.
 * sourceId is used for rate limiting (e.g. Slack user ID or IP).
 * claimingUserId, if provided, must match the user who generated the code.
 */
export function claimPairingCode(
  code: string,
  sourceId?: string,
  claimingUserId?: string,
): { request: PairingRequest | null; error?: string } {
  // Rate limit check
  if (sourceId && !checkClaimRateLimit(sourceId)) {
    return { request: null, error: "Rate limited. Try again in 1 minute." };
  }

  const normalizedCode = code.trim().toUpperCase();
  const request = pendingPairings.get(normalizedCode);

  if (!request) {
    return { request: null, error: "Invalid or expired pairing code" };
  }

  // Check expiry
  if (Date.now() - request.createdAt > PAIRING_CODE_TTL_MS) {
    pendingPairings.delete(normalizedCode);
    return { request: null, error: "Pairing code has expired" };
  }

  // Check if already claimed (race condition guard)
  if (request.claimed) {
    return { request: null, error: "Pairing code has already been claimed" };
  }

  // Bind check: code must be claimed by the same Slack user who generated it
  if (claimingUserId && request.slackUserId !== claimingUserId) {
    return {
      request: null,
      error: "This pairing code was not generated for your account",
    };
  }

  // Mark as claimed and remove
  request.claimed = true;
  pendingPairings.delete(normalizedCode);
  return { request };
}

/**
 * Get a pending pairing request by code (for display).
 */
export function getPairingRequest(code: string): PairingRequest | null {
  const normalizedCode = code.trim().toUpperCase();
  const request = pendingPairings.get(normalizedCode);

  if (!request) {
    return null;
  }

  // Check expiry
  if (Date.now() - request.createdAt > PAIRING_CODE_TTL_MS) {
    pendingPairings.delete(normalizedCode);
    return null;
  }

  return request;
}

/**
 * List all pending pairing requests (for admin).
 */
export function listPairingRequests(): PairingRequest[] {
  const now = Date.now();
  const valid: PairingRequest[] = [];

  for (const [code, request] of pendingPairings) {
    if (now - request.createdAt <= PAIRING_CODE_TTL_MS) {
      valid.push(request);
    } else {
      pendingPairings.delete(code);
    }
  }

  return valid;
}

/**
 * Clean up expired pairing requests and stale rate limit entries
 */
export function cleanupExpiredPairings(): void {
  const now = Date.now();
  for (const [code, request] of pendingPairings) {
    if (now - request.createdAt > PAIRING_CODE_TTL_MS) {
      pendingPairings.delete(code);
    }
  }
  for (const [sourceId, attempt] of claimAttempts) {
    if (now - attempt.windowStart > CLAIM_RATE_LIMIT_WINDOW_MS) {
      claimAttempts.delete(sourceId);
    }
  }
  for (const [userId, attempt] of requestAttempts) {
    if (now - attempt.windowStart > REQUEST_RATE_LIMIT_WINDOW_MS) {
      requestAttempts.delete(userId);
    }
  }
}

/**
 * Build the pairing message to send to the user (Slack mrkdwn format)
 */
export function buildPairingMessage(code: string): string {
  return [
    "*Pairing Required*",
    "",
    `Your pairing code is: \`${code}\``,
    "",
    "To approve your account, run this command:",
    "```",
    `wopr slack claim ${code}`,
    "```",
    "",
    "_This code expires in 15 minutes._",
  ].join("\n");
}

/**
 * Check if a user is in the DM allowlist
 */
export function isUserAllowed(ctx: WOPRPluginContext, userId: string): boolean {
  const config = ctx.getConfig<{
    channels?: { slack?: { dm?: { allowFrom?: string[] } } };
  }>();
  const allowFrom = config?.channels?.slack?.dm?.allowFrom || [];
  return allowFrom.includes("*") || allowFrom.includes(userId);
}

/**
 * Add a user to the DM allowlist
 */
export async function approveUser(ctx: WOPRPluginContext, userId: string): Promise<void> {
  interface MutableConfig {
    channels?: {
      slack?: {
        dm?: { allowFrom?: string[] };
      };
    };
  }
  const config = ctx.getConfig<MutableConfig>();

  // Ensure nested structure exists
  if (!config.channels) config.channels = {};
  if (!config.channels.slack) config.channels.slack = {};
  if (!config.channels.slack.dm) config.channels.slack.dm = {};
  if (!Array.isArray(config.channels.slack.dm.allowFrom)) {
    config.channels.slack.dm.allowFrom = [];
  }

  // Add user if not already present
  if (!config.channels.slack.dm.allowFrom.includes(userId)) {
    config.channels.slack.dm.allowFrom.push(userId);
    try {
      await ctx.saveConfig(config);
    } catch (error: unknown) {
      throw new Error(
        `Failed to save config after approving user ${userId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
