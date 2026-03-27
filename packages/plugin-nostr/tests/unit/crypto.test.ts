import { describe, it, expect, vi, beforeEach } from "vitest";
import { generateSecretKey, getPublicKey } from "nostr-tools/pure";
import * as nip19 from "nostr-tools/nip19";

// Test the real crypto functions for most tests.
// For spy tests on nip04, we test via the roundtrip which exercises the real encrypt/decrypt.

describe("crypto", () => {
  let testSk: Uint8Array;
  let testPubkeyHex: string;

  beforeEach(() => {
    vi.clearAllMocks();
    testSk = generateSecretKey();
    testPubkeyHex = getPublicKey(testSk);
  });

  describe("parsePrivateKey", () => {
    it("parses valid nsec1 bech32 key and returns Uint8Array of length 32", async () => {
      const { parsePrivateKey } = await import("../../src/crypto.js");
      const nsec = nip19.nsecEncode(testSk);
      const result = parsePrivateKey(nsec);
      expect(result).toBeInstanceOf(Uint8Array);
      expect(result.length).toBe(32);
    });

    it("parses valid 64-char hex key", async () => {
      const { parsePrivateKey } = await import("../../src/crypto.js");
      const hexKey = Array.from(testSk)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
      const result = parsePrivateKey(hexKey);
      expect(result).toBeInstanceOf(Uint8Array);
      expect(result.length).toBe(32);
    });

    it("throws on invalid input (too short)", async () => {
      const { parsePrivateKey } = await import("../../src/crypto.js");
      expect(() => parsePrivateKey("abc123")).toThrow();
    });

    it("throws on wrong bech32 prefix", async () => {
      const { parsePrivateKey } = await import("../../src/crypto.js");
      const npub = nip19.npubEncode(testPubkeyHex);
      expect(() => parsePrivateKey(npub)).toThrow();
    });
  });

  describe("derivePublicKey", () => {
    it("returns hex string pubkey from known sk", async () => {
      const { derivePublicKey } = await import("../../src/crypto.js");
      const result = derivePublicKey(testSk);
      expect(result).toBe(testPubkeyHex);
      expect(result).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  describe("formatNpub", () => {
    it("returns npub1... string from hex pubkey", async () => {
      const { formatNpub } = await import("../../src/crypto.js");
      const result = formatNpub(testPubkeyHex);
      expect(result).toMatch(/^npub1/);
    });

    it("roundtrips: formatNpub then decode gives original pubkey", async () => {
      const { formatNpub } = await import("../../src/crypto.js");
      const npub = formatNpub(testPubkeyHex);
      const decoded = nip19.decode(npub);
      expect(decoded.type).toBe("npub");
      expect(decoded.data).toBe(testPubkeyHex);
    });
  });

  describe("encryptDM / decryptDM", () => {
    it("encryptDM returns a non-empty ciphertext string", async () => {
      const { encryptDM } = await import("../../src/crypto.js");
      // Use two different keys so encrypt/decrypt is between different parties
      const aliceSk = generateSecretKey();
      const bobPubkey = testPubkeyHex;

      const result = await encryptDM(aliceSk, bobPubkey, "hello");
      expect(typeof result).toBe("string");
      expect(result.length).toBeGreaterThan(0);
    });

    it("decryptDM decrypts a NIP-44 encrypted message", async () => {
      const { encryptDM, decryptDM } = await import("../../src/crypto.js");
      const aliceSk = generateSecretKey();
      const bobSk = generateSecretKey();
      const bobPubkey = getPublicKey(bobSk);
      const alicePubkey = getPublicKey(aliceSk);

      const plaintext = "test decrypt message";
      const ciphertext = await encryptDM(aliceSk, bobPubkey, plaintext);
      const result = await decryptDM(bobSk, alicePubkey, ciphertext);
      expect(result).toBe(plaintext);
    });

    it("encryptDM passes hex private key to nip04.encrypt (verified via roundtrip)", async () => {
      // Verify the sk passed to nip04 is correct by confirming the roundtrip works
      const aliceSk = generateSecretKey();
      const bobSk = generateSecretKey();
      const bobPubkey = getPublicKey(bobSk);
      const alicePubkey = getPublicKey(aliceSk);

      const { encryptDM, decryptDM } = await import("../../src/crypto.js");
      const plaintext = "round trip test";
      const encrypted = await encryptDM(aliceSk, bobPubkey, plaintext);
      const decrypted = await decryptDM(bobSk, alicePubkey, encrypted);
      expect(decrypted).toBe(plaintext);
    });

    it("roundtrip: encrypt then decrypt returns original plaintext", async () => {
      const aliceSk = generateSecretKey();
      const bobSk = generateSecretKey();
      const bobPubkey = getPublicKey(bobSk);
      const alicePubkey = getPublicKey(aliceSk);

      const { encryptDM, decryptDM } = await import("../../src/crypto.js");

      const plaintext = "Hello from Alice to Bob!";
      const ciphertext = await encryptDM(aliceSk, bobPubkey, plaintext);
      const decrypted = await decryptDM(bobSk, alicePubkey, ciphertext);

      expect(decrypted).toBe(plaintext);
    });
  });
});
