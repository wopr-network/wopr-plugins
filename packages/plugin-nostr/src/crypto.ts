import * as nip19 from "nostr-tools/nip19";
import * as nip44 from "nostr-tools/nip44";
import { getPublicKey } from "nostr-tools/pure";

function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error("Invalid hex string: odd length");
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = Number.parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

/**
 * Parse an nsec (bech32) or hex private key string into a Uint8Array.
 * Throws if the key is invalid.
 */
export function parsePrivateKey(keyInput: string): Uint8Array {
  if (keyInput.startsWith("nsec1")) {
    const decoded = nip19.decode(keyInput);
    if (decoded.type !== "nsec") {
      throw new Error(`Expected nsec key, got ${decoded.type}`);
    }
    const key = decoded.data as Uint8Array;
    if (key.length !== 32) {
      throw new Error(`Invalid key length: expected 32 bytes, got ${key.length}`);
    }
    return key;
  }

  // Treat as hex
  if (!/^[0-9a-fA-F]{64}$/.test(keyInput)) {
    throw new Error(`Invalid hex private key: expected 64 hex characters, got ${keyInput.length} characters`);
  }
  const key = hexToBytes(keyInput);
  if (key.length !== 32) {
    throw new Error(`Invalid key length: expected 32 bytes, got ${key.length}`);
  }
  return key;
}

/**
 * Derive the hex public key from a Uint8Array secret key.
 */
export function derivePublicKey(sk: Uint8Array): string {
  return getPublicKey(sk);
}

/**
 * Format a hex pubkey as npub (bech32) for display.
 */
export function formatNpub(hexPubkey: string): string {
  return nip19.npubEncode(hexPubkey);
}

/**
 * Encrypt a plaintext message for a recipient using NIP-44.
 * Returns the ciphertext string.
 */
export async function encryptDM(sk: Uint8Array, recipientPubkey: string, plaintext: string): Promise<string> {
  const conversationKey = nip44.getConversationKey(sk, recipientPubkey);
  return nip44.encrypt(plaintext, conversationKey);
}

/**
 * Decrypt a NIP-44 ciphertext from a sender.
 * Returns the plaintext string.
 */
export async function decryptDM(sk: Uint8Array, senderPubkey: string, ciphertext: string): Promise<string> {
  const conversationKey = nip44.getConversationKey(sk, senderPubkey);
  return nip44.decrypt(ciphertext, conversationKey);
}
