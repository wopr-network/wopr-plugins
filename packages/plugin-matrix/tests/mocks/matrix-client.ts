import { vi } from "vitest";

export function createMockMatrixClient(overrides: Record<string, unknown> = {}) {
  const eventHandlers = new Map<string, ((...args: unknown[]) => void)[]>();
  return {
    getUserId: vi.fn().mockResolvedValue("@bot:example.org"),
    getJoinedRooms: vi.fn().mockResolvedValue([]),
    getJoinedRoomMembers: vi.fn().mockResolvedValue(["@bot:example.org", "@user:example.org"]),
    getRoomStateEvent: vi.fn().mockRejectedValue(new Error("not found")),
    getUserProfile: vi.fn().mockResolvedValue({ displayname: "Bot" }),
    sendMessage: vi.fn().mockResolvedValue("$event123"),
    sendTyping: vi.fn().mockResolvedValue(undefined),
    downloadContent: vi.fn().mockResolvedValue({ data: Buffer.from("test") }),
    uploadContent: vi.fn().mockResolvedValue("mxc://example.org/abc123"),
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn(),
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      if (!eventHandlers.has(event)) eventHandlers.set(event, []);
      eventHandlers.get(event)!.push(handler);
    }),
    off: vi.fn(),
    accessToken: "mock-access-token",
    _eventHandlers: eventHandlers,
    ...overrides,
  };
}
