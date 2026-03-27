import { describe, it, expect, vi, beforeEach } from "vitest";
import { generateSecretKey, getPublicKey } from "nostr-tools/pure";

const { mockFinalizeEvent } = vi.hoisted(() => ({
  mockFinalizeEvent: vi.fn().mockImplementation((template: Record<string, unknown>) => ({
    ...template,
    id: "mock-event-id",
    pubkey: "mock-pubkey",
    sig: "mock-sig",
  })),
}));

vi.mock("nostr-tools/pure", async (importOriginal) => {
  const actual = await importOriginal<typeof import("nostr-tools/pure")>();
  return {
    ...actual,
    finalizeEvent: mockFinalizeEvent,
  };
});

const { mockEncryptDM } = vi.hoisted(() => ({
  mockEncryptDM: vi.fn().mockResolvedValue("encrypted-ciphertext"),
}));

vi.mock("../../src/crypto.js", () => ({
  encryptDM: mockEncryptDM,
  decryptDM: vi.fn().mockResolvedValue("decrypted-plaintext"),
  parsePrivateKey: vi.fn(),
  derivePublicKey: vi.fn(),
  formatNpub: vi.fn(),
}));

describe("EventPublisher", () => {
  let testSk: Uint8Array;
  let testPubkey: string;
  let mockPool: {
    publish: ReturnType<typeof vi.fn>;
    subscribe: ReturnType<typeof vi.fn>;
    getRelayUrls: ReturnType<typeof vi.fn>;
    getStatuses: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
    getPool: ReturnType<typeof vi.fn>;
  };
  let mockLog: { info: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();
    testSk = generateSecretKey();
    testPubkey = getPublicKey(testSk);
    mockFinalizeEvent.mockImplementation((template: Record<string, unknown>) => ({
      ...template,
      id: "mock-event-id",
      pubkey: "mock-pubkey",
      sig: "mock-sig",
    }));
    mockEncryptDM.mockResolvedValue("encrypted-ciphertext");
    mockPool = {
      publish: vi.fn().mockResolvedValue(undefined),
      subscribe: vi.fn(),
      getRelayUrls: vi.fn().mockReturnValue(["wss://relay.damus.io"]),
      getStatuses: vi.fn().mockReturnValue([]),
      close: vi.fn(),
      getPool: vi.fn(),
    };
    mockLog = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
  });

  it("publishReply creates kind 1 event with correct tags and calls pool.publish", async () => {
    const { EventPublisher } = await import("../../src/event-publisher.js");
    const publisher = new EventPublisher(testSk, mockPool as never, mockLog);
    const parentEventId = "parent-event-abc";
    const parentPubkey = testPubkey;

    const eventId = await publisher.publishReply("hello world", parentEventId, parentPubkey);

    expect(mockFinalizeEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 1,
        content: "hello world",
        tags: expect.arrayContaining([
          ["e", parentEventId, "", "reply"],
          ["p", parentPubkey],
        ]),
      }),
      testSk,
    );
    expect(mockPool.publish).toHaveBeenCalled();
    expect(eventId).toBe("mock-event-id");
  });

  it("publishDM encrypts content, creates kind 4 event with p tag, calls pool.publish", async () => {
    const { EventPublisher } = await import("../../src/event-publisher.js");
    const { encryptDM } = await import("../../src/crypto.js");
    const publisher = new EventPublisher(testSk, mockPool as never, mockLog);
    const recipientPubkey = testPubkey;

    const eventId = await publisher.publishDM("secret message", recipientPubkey);

    expect(encryptDM).toHaveBeenCalledWith(testSk, recipientPubkey, "secret message");
    expect(mockFinalizeEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 4,
        content: "encrypted-ciphertext",
        tags: [["p", recipientPubkey]],
      }),
      testSk,
    );
    expect(mockPool.publish).toHaveBeenCalled();
    expect(eventId).toBe("mock-event-id");
  });

  it("publishDM propagates encryption errors", async () => {
    mockEncryptDM.mockRejectedValueOnce(new Error("Encryption failed"));

    const { EventPublisher } = await import("../../src/event-publisher.js");
    const publisher = new EventPublisher(testSk, mockPool as never, mockLog);

    await expect(publisher.publishDM("message", testPubkey)).rejects.toThrow("Encryption failed");
  });

  it("publishReply propagates publish errors", async () => {
    mockPool.publish.mockRejectedValueOnce(new Error("Publish failed"));

    const { EventPublisher } = await import("../../src/event-publisher.js");
    const publisher = new EventPublisher(testSk, mockPool as never, mockLog);

    await expect(publisher.publishReply("content", "event-id", testPubkey)).rejects.toThrow("Publish failed");
  });
});
