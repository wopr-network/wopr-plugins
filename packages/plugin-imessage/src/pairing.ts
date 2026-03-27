/**
 * iMessage Contact Pairing
 *
 * Allows unknown contacts to approve themselves via a pairing code.
 * When dmPolicy is "pairing", unknown senders receive a code and must
 * run `wopr imessage approve <code>` to be added to the allowlist.
 */

import crypto from "node:crypto";
import type { IMessageConfig, WOPRPluginContext } from "./types.js";

const PAIRING_CODE_LENGTH = 8;
const PAIRING_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // No ambiguous chars
const PAIRING_CODE_TTL_MS = 15 * 60 * 1000; // 15 minutes

const CLAIM_RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const CLAIM_RATE_LIMIT_MAX_ATTEMPTS = 5;

interface ClaimAttempt {
  count: number;
  windowStart: number;
}

export interface PairingRequest {
  code: string;
  handle: string; // phone number or email
  createdAt: number;
  claimed: boolean;
}

const pendingPairings: Map<string, PairingRequest> = new Map();
const claimAttempts: Map<string, ClaimAttempt> = new Map();

function generateCode(): string {
  let code = "";
  for (let i = 0; i < PAIRING_CODE_LENGTH; i++) {
    const idx = crypto.randomInt(0, PAIRING_CODE_ALPHABET.length);
    code += PAIRING_CODE_ALPHABET[idx];
  }
  return code;
}

function generateUniqueCode(): string {
  const existingCodes = new Set(Array.from(pendingPairings.values()).map((p) => p.code));
  for (let attempt = 0; attempt < 100; attempt++) {
    const code = generateCode();
    if (!existingCodes.has(code)) {
      return code;
    }
  }
  throw new Error("Failed to generate unique pairing code");
}

/**
 * Create a pairing request for an iMessage sender.
 * Returns an existing code if one is already pending for this handle.
 */
export function createPairingRequest(handle: string): string {
  // Reuse existing pending request for same handle
  for (const [_code, request] of pendingPairings) {
    if (request.handle === handle && !request.claimed) {
      request.createdAt = Date.now(); // refresh TTL
      return request.code;
    }
  }

  const code = generateUniqueCode();
  pendingPairings.set(code, {
    code,
    handle,
    createdAt: Date.now(),
    claimed: false,
  });

  return code;
}

/**
 * Check if a claim source is rate-limited.
 * Returns true if allowed, false if rate-limited.
 */
export function checkClaimRateLimit(sourceId: string): boolean {
  const now = Date.now();
  const attempt = claimAttempts.get(sourceId);

  if (!attempt || now - attempt.windowStart > CLAIM_RATE_LIMIT_WINDOW_MS) {
    claimAttempts.set(sourceId, { count: 1, windowStart: now });
    return true;
  }

  attempt.count++;
  return attempt.count <= CLAIM_RATE_LIMIT_MAX_ATTEMPTS;
}

/**
 * Claim a pairing code. On success, adds the handle to the allowlist.
 */
export async function claimPairingCode(
  code: string,
  ctx: WOPRPluginContext,
  sourceId?: string,
): Promise<{ handle: string | null; error?: string }> {
  if (sourceId && !checkClaimRateLimit(sourceId)) {
    return { handle: null, error: "Rate limited. Try again in 1 minute." };
  }

  const normalizedCode = code.trim().toUpperCase();
  const request = pendingPairings.get(normalizedCode);

  if (!request) {
    return { handle: null, error: "Invalid or expired pairing code." };
  }

  if (Date.now() - request.createdAt > PAIRING_CODE_TTL_MS) {
    pendingPairings.delete(normalizedCode);
    return { handle: null, error: "Pairing code has expired." };
  }

  if (request.claimed) {
    return { handle: null, error: "Pairing code has already been claimed." };
  }

  // Mark claimed and remove
  request.claimed = true;
  pendingPairings.delete(normalizedCode);

  // Add handle to allowlist in config
  const config = ctx.getConfig<{ channels?: { imessage?: IMessageConfig } }>();
  const imessageConfig = config?.channels?.imessage || {};
  const allowFrom = imessageConfig.allowFrom || [];

  if (!allowFrom.includes(request.handle)) {
    allowFrom.push(request.handle);
    const updatedConfig = {
      ...config,
      channels: {
        ...config?.channels,
        imessage: {
          ...imessageConfig,
          allowFrom,
        },
      },
    };
    await ctx.saveConfig(updatedConfig);
  }

  return { handle: request.handle };
}

/**
 * Get a pending pairing request by code.
 */
export function getPairingRequest(code: string): PairingRequest | null {
  const normalizedCode = code.trim().toUpperCase();
  const request = pendingPairings.get(normalizedCode);

  if (!request) return null;

  if (Date.now() - request.createdAt > PAIRING_CODE_TTL_MS) {
    pendingPairings.delete(normalizedCode);
    return null;
  }

  return request;
}

/**
 * Build the pairing message to send back to the unknown contact.
 * Uses plain text since iMessage doesn't render Markdown.
 */
export function buildPairingMessage(code: string): string {
  return [
    "Hi! I don't recognize your number yet.",
    "",
    `Your pairing code is: ${code}`,
    "",
    "To approve your contact, ask the bot owner to run:",
    `  wopr imessage approve ${code}`,
    "",
    "This code expires in 15 minutes.",
  ].join("\n");
}

/**
 * Clean up expired pairing requests and stale rate limit entries.
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
}

/**
 * List all pending pairing requests (for admin/debug).
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
