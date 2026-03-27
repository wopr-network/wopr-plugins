import { beforeEach, describe, expect, it, vi } from "vitest";
import { StreamManager } from "../src/stream-manager.js";

const mockUpdateStreamRules = vi.fn().mockResolvedValue({});
const mockStreamRules = vi.fn().mockResolvedValue({ data: [{ id: "r1", tag: "test-tag" }] });
const mockStream = {
  autoReconnect: false,
  autoReconnectRetries: 0,
  on: vi.fn(),
  close: vi.fn(),
};
const mockSearchStream = vi.fn().mockResolvedValue(mockStream);

const mockClient = {
  raw: {
    v2: {
      updateStreamRules: mockUpdateStreamRules,
      streamRules: mockStreamRules,
      searchStream: mockSearchStream,
    },
  },
} as any;

describe("StreamManager", () => {
  let manager: StreamManager;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new StreamManager(mockClient);
  });

  it("adds a stream rule", async () => {
    await manager.addRule("@testbot", "mention");
    expect(mockUpdateStreamRules).toHaveBeenCalledWith({
      add: [{ value: "@testbot", tag: "mention" }],
    });
  });

  it("removes stream rules by tag", async () => {
    await manager.removeRulesByTag("test-tag");
    expect(mockUpdateStreamRules).toHaveBeenCalledWith({
      delete: { ids: ["r1"] },
    });
  });

  it("does not call delete when no matching rules", async () => {
    mockStreamRules.mockResolvedValueOnce({ data: [{ id: "r2", tag: "other-tag" }] });
    await manager.removeRulesByTag("test-tag");
    expect(mockUpdateStreamRules).not.toHaveBeenCalled();
  });

  it("connects to filtered stream", async () => {
    const onTweet = vi.fn();
    await manager.connect(onTweet);
    expect(mockSearchStream).toHaveBeenCalled();
    expect(mockStream.on).toHaveBeenCalledWith("data", expect.any(Function));
  });

  it("disconnects cleanly", async () => {
    const onTweet = vi.fn();
    await manager.connect(onTweet);
    await manager.disconnect();
    expect(mockStream.close).toHaveBeenCalled();
  });

  it("sets shuttingDown flag on disconnect", async () => {
    const onTweet = vi.fn();
    await manager.connect(onTweet);
    expect(manager.shuttingDown).toBe(false);
    await manager.disconnect();
    expect(manager.shuttingDown).toBe(true);
  });

  it("handles disconnect without prior connect", async () => {
    await expect(manager.disconnect()).resolves.toBeUndefined();
  });
});
