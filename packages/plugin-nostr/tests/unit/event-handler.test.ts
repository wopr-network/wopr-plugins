import { describe, it, expect, vi, beforeEach } from "vitest";
import { generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { createMockContext } from "../mocks/wopr-context.js";

const { mockVerifyEvent } = vi.hoisted(() => ({
  mockVerifyEvent: vi.fn().mockReturnValue(true),
}));

vi.mock("nostr-tools/pure", async (importOriginal) => {
  const actual = await importOriginal<typeof import("nostr-tools/pure")>();
  return {
    ...actual,
    verifyEvent: mockVerifyEvent,
  };
});

const { mockDecryptDM, mockFormatNpub } = vi.hoisted(() => ({
  mockDecryptDM: vi.fn().mockResolvedValue("decrypted message"),
  mockFormatNpub: vi.fn().mockImplementation((pubkey: string) => `npub1${pubkey.slice(0, 8)}`),
}));

vi.mock("../../src/crypto.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/crypto.js")>();
  return {
    ...actual,
    decryptDM: mockDecryptDM,
    encryptDM: vi.fn().mockResolvedValue("encrypted"),
    formatNpub: mockFormatNpub,
  };
});

describe("EventHandler", () => {
  let botSk: Uint8Array;
  let botPubkey: string;
  let senderSk: Uint8Array;
  let senderPubkey: string;
  let mockPublisher: {
    publishDM: ReturnType<typeof vi.fn>;
    publishReply: ReturnType<typeof vi.fn>;
  };
  let mockCtx: ReturnType<typeof createMockContext>;

  beforeEach(() => {
    vi.clearAllMocks();
    botSk = generateSecretKey();
    botPubkey = getPublicKey(botSk);
    senderSk = generateSecretKey();
    senderPubkey = getPublicKey(senderSk);
    mockVerifyEvent.mockReturnValue(true);
    mockDecryptDM.mockResolvedValue("decrypted message");
    mockFormatNpub.mockImplementation((pubkey: string) => `npub1${pubkey.slice(0, 8)}`);

    mockPublisher = {
      publishDM: vi.fn().mockResolvedValue("event-id"),
      publishReply: vi.fn().mockResolvedValue("reply-event-id"),
    };
    mockCtx = createMockContext();
    vi.mocked(mockCtx.inject).mockResolvedValue("AI response");
  });

  const makeDMEvent = (overrides: Record<string, unknown> = {}) => ({
    id: "event-id-123",
    pubkey: senderPubkey,
    kind: 4,
    created_at: Math.floor(Date.now() / 1000),
    content: "encrypted-dm-content",
    tags: [["p", botPubkey]],
    sig: "sig",
    ...overrides,
  });

  const makeMentionEvent = (overrides: Record<string, unknown> = {}) => ({
    id: "mention-event-id",
    pubkey: senderPubkey,
    kind: 1,
    created_at: Math.floor(Date.now() / 1000),
    content: `hello bot!`,
    tags: [["p", botPubkey]],
    sig: "sig",
    ...overrides,
  });

  it("ignores events from self (event.pubkey === botPubkey)", async () => {
    const { EventHandler } = await import("../../src/event-handler.js");
    const handler = new EventHandler(botSk, {}, mockCtx, mockPublisher as never);
    const selfEvent = makeDMEvent({ pubkey: botPubkey });

    await handler.handleEvent(selfEvent);

    expect(mockCtx.inject).not.toHaveBeenCalled();
    expect(mockPublisher.publishDM).not.toHaveBeenCalled();
  });

  it("ignores events that fail verifyEvent", async () => {
    mockVerifyEvent.mockReturnValueOnce(false);
    const { EventHandler } = await import("../../src/event-handler.js");
    const handler = new EventHandler(botSk, {}, mockCtx, mockPublisher as never);
    const event = makeDMEvent();

    await handler.handleEvent(event);

    expect(mockCtx.inject).not.toHaveBeenCalled();
  });

  it("handles kind 4 DM — decrypts, calls ctx.inject, publishes DM reply", async () => {
    const { EventHandler } = await import("../../src/event-handler.js");
    const handler = new EventHandler(botSk, { dmPolicy: "open" }, mockCtx, mockPublisher as never);
    const event = makeDMEvent();

    await handler.handleEvent(event);

    expect(mockDecryptDM).toHaveBeenCalledWith(botSk, senderPubkey, "encrypted-dm-content");
    expect(mockCtx.inject).toHaveBeenCalled();
    expect(mockPublisher.publishDM).toHaveBeenCalledWith("AI response", senderPubkey);
  });

  it("handles kind 4 DM — respects dmPolicy disabled (no inject)", async () => {
    const { EventHandler } = await import("../../src/event-handler.js");
    const handler = new EventHandler(botSk, { dmPolicy: "disabled" }, mockCtx, mockPublisher as never);
    const event = makeDMEvent();

    await handler.handleEvent(event);

    expect(mockCtx.inject).not.toHaveBeenCalled();
    expect(mockPublisher.publishDM).not.toHaveBeenCalled();
  });

  it("handles kind 4 DM — allows DM from allowlisted pubkey", async () => {
    const { EventHandler } = await import("../../src/event-handler.js");
    const handler = new EventHandler(
      botSk,
      { dmPolicy: "allowlist", allowedPubkeys: [senderPubkey] },
      mockCtx,
      mockPublisher as never,
    );
    const event = makeDMEvent();

    await handler.handleEvent(event);

    expect(mockCtx.inject).toHaveBeenCalled();
    expect(mockPublisher.publishDM).toHaveBeenCalledWith("AI response", senderPubkey);
  });

  it("handles kind 4 DM — blocks DM from non-allowlisted pubkey", async () => {
    const { EventHandler } = await import("../../src/event-handler.js");
    const handler = new EventHandler(
      botSk,
      { dmPolicy: "allowlist", allowedPubkeys: ["other-pubkey"] },
      mockCtx,
      mockPublisher as never,
    );
    const event = makeDMEvent();

    await handler.handleEvent(event);

    expect(mockCtx.inject).not.toHaveBeenCalled();
  });

  it("handles kind 1 mention — injects and publishes reply when enablePublicReplies=true", async () => {
    const { EventHandler } = await import("../../src/event-handler.js");
    const handler = new EventHandler(
      botSk,
      { enablePublicReplies: true },
      mockCtx,
      mockPublisher as never,
    );
    const event = makeMentionEvent();

    await handler.handleEvent(event);

    expect(mockCtx.inject).toHaveBeenCalled();
    expect(mockPublisher.publishReply).toHaveBeenCalledWith("AI response", "mention-event-id", senderPubkey);
  });

  it("ignores kind 1 mention when enablePublicReplies=false", async () => {
    const { EventHandler } = await import("../../src/event-handler.js");
    const handler = new EventHandler(
      botSk,
      { enablePublicReplies: false },
      mockCtx,
      mockPublisher as never,
    );
    const event = makeMentionEvent();

    await handler.handleEvent(event);

    expect(mockCtx.inject).not.toHaveBeenCalled();
  });

  it("handles decryption errors gracefully (logs error, does not crash)", async () => {
    mockDecryptDM.mockRejectedValueOnce(new Error("Decryption failed"));
    const { EventHandler } = await import("../../src/event-handler.js");
    const handler = new EventHandler(botSk, { dmPolicy: "open" }, mockCtx, mockPublisher as never);
    const event = makeDMEvent();

    // Should not throw
    await expect(handler.handleEvent(event)).resolves.toBeUndefined();
    expect(mockCtx.log.error).toHaveBeenCalled();
  });

  it("handles inject errors gracefully (logs error, does not crash)", async () => {
    vi.mocked(mockCtx.inject).mockRejectedValueOnce(new Error("Inject failed"));
    const { EventHandler } = await import("../../src/event-handler.js");
    const handler = new EventHandler(botSk, { dmPolicy: "open" }, mockCtx, mockPublisher as never);
    const event = makeDMEvent();

    // Should not throw
    await expect(handler.handleEvent(event)).resolves.toBeUndefined();
    expect(mockCtx.log.error).toHaveBeenCalled();
  });
});
