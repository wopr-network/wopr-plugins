import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PluginLogger } from "../../src/types.js";

const { mockClose, mockSubscribe, mockPublish } = vi.hoisted(() => ({
  mockClose: vi.fn(),
  mockSubscribe: vi.fn().mockReturnValue({ close: vi.fn() }),
  mockPublish: vi.fn().mockReturnValue([Promise.resolve("accepted")]),
}));

vi.mock("nostr-tools/pool", () => ({
  SimplePool: class MockSimplePool {
    subscribe = mockSubscribe;
    publish = mockPublish;
    close = mockClose;
  },
}));

describe("RelayPoolManager", () => {
  const relayUrls = ["wss://relay.damus.io", "wss://nos.lol"];
  let mockLog: PluginLogger;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSubscribe.mockReturnValue({ close: vi.fn() });
    mockPublish.mockReturnValue([Promise.resolve("accepted")]);
    mockLog = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };
  });

  it("stores relay URLs and creates SimplePool on construction", async () => {
    const { RelayPoolManager } = await import("../../src/relay-pool.js");
    const manager = new RelayPoolManager(relayUrls, mockLog);
    expect(manager.getRelayUrls()).toEqual(relayUrls);
  });

  it("getRelayUrls returns configured URLs", async () => {
    const { RelayPoolManager } = await import("../../src/relay-pool.js");
    const manager = new RelayPoolManager(relayUrls, mockLog);
    expect(manager.getRelayUrls()).toEqual(relayUrls);
  });

  it("subscribe delegates to SimplePool.subscribe with correct relay URLs and filters", async () => {
    const { RelayPoolManager } = await import("../../src/relay-pool.js");
    const manager = new RelayPoolManager(relayUrls, mockLog);
    const filters = [{ kinds: [4], "#p": ["abc123"] }];
    const callbacks = { onevent: vi.fn(), oneose: vi.fn() };

    manager.subscribe(filters as never, callbacks);

    expect(mockSubscribe).toHaveBeenCalledWith(
      relayUrls,
      { kinds: [4], "#p": ["abc123"] },
      expect.objectContaining({ onevent: expect.any(Function) }),
    );
  });

  it("publish delegates to pool.publish and resolves when at least one relay accepts", async () => {
    const { RelayPoolManager } = await import("../../src/relay-pool.js");
    const manager = new RelayPoolManager(relayUrls, mockLog);
    const signedEvent = { id: "abc", kind: 1, content: "hello" };

    await expect(manager.publish(signedEvent)).resolves.toBeUndefined();
    expect(mockPublish).toHaveBeenCalledWith(relayUrls, signedEvent);
  });

  it("publish logs error and rejects when all relays reject", async () => {
    mockPublish.mockReturnValue([Promise.reject(new Error("relay1 rejected")), Promise.reject(new Error("relay2 rejected"))]);

    const { RelayPoolManager } = await import("../../src/relay-pool.js");
    const manager = new RelayPoolManager(relayUrls, mockLog);
    const signedEvent = { id: "abc", kind: 1, content: "hello" };

    await expect(manager.publish(signedEvent)).rejects.toThrow("Failed to publish event to any relay");
    expect(mockLog.error).toHaveBeenCalled();
  });

  it("close calls pool.close with relay URLs", async () => {
    const { RelayPoolManager } = await import("../../src/relay-pool.js");
    const manager = new RelayPoolManager(relayUrls, mockLog);
    manager.close();
    expect(mockClose).toHaveBeenCalledWith(relayUrls);
  });

  it("getStatuses returns status object for each configured relay", async () => {
    const { RelayPoolManager } = await import("../../src/relay-pool.js");
    const manager = new RelayPoolManager(relayUrls, mockLog);
    const statuses = manager.getStatuses();
    expect(statuses).toHaveLength(relayUrls.length);
    for (const status of statuses) {
      expect(relayUrls).toContain(status.url);
      expect(typeof status.connected).toBe("boolean");
      expect(typeof status.reconnectAttempts).toBe("number");
    }
  });
});
