import { describe, expect, it } from "vitest";
import { getSessionKey, getUserDisplayName, isDMRoom } from "../../src/matrix-utils.js";
import { createMockMatrixClient } from "../mocks/matrix-client.js";

describe("getSessionKey", () => {
  it("returns DM format for 2-member rooms", async () => {
    const mockClient = createMockMatrixClient({
      getJoinedRoomMembers: async () => ["@bot:example.org", "@alice:example.org"],
      getUserId: async () => "@bot:example.org",
    });

    const key = await getSessionKey(mockClient as never, "!room:example.org");
    expect(key).toBe("matrix:dm:alice");
  });

  it("returns room name format for group rooms", async () => {
    const mockClient = createMockMatrixClient({
      getJoinedRoomMembers: async () => ["@bot:example.org", "@alice:example.org", "@bob:example.org"],
      getUserId: async () => "@bot:example.org",
      getRoomStateEvent: async (_roomId: string, type: string) => {
        if (type === "m.room.name") return { name: "General" };
        throw new Error("not found");
      },
    });

    const key = await getSessionKey(mockClient as never, "!room:example.org");
    expect(key).toBe("matrix:general");
  });

  it("falls back to room ID when name fetch fails", async () => {
    const mockClient = createMockMatrixClient({
      getJoinedRoomMembers: async () => {
        throw new Error("network error");
      },
    });

    const key = await getSessionKey(mockClient as never, "!myroom:example.org");
    expect(key).toContain("matrix:");
  });
});

describe("getUserDisplayName", () => {
  it("returns room member displayname when available", async () => {
    const mockClient = createMockMatrixClient({
      getRoomStateEvent: async (_roomId: string, type: string) => {
        if (type === "m.room.member") return { displayname: "Alice Smith" };
        throw new Error("not found");
      },
    });

    const name = await getUserDisplayName(mockClient as never, "@alice:example.org", "!room:example.org");
    expect(name).toBe("Alice Smith");
  });

  it("falls back to profile displayname", async () => {
    const mockClient = createMockMatrixClient({
      getRoomStateEvent: async () => {
        throw new Error("not found");
      },
      getUserProfile: async () => ({ displayname: "Alice" }),
    });

    const name = await getUserDisplayName(mockClient as never, "@alice:example.org");
    expect(name).toBe("Alice");
  });

  it("falls back to localpart when no displayname found", async () => {
    const mockClient = createMockMatrixClient({
      getRoomStateEvent: async () => {
        throw new Error("not found");
      },
      getUserProfile: async () => ({}),
    });

    const name = await getUserDisplayName(mockClient as never, "@alice:example.org");
    expect(name).toBe("alice");
  });
});

describe("isDMRoom", () => {
  it("returns true for 2-member rooms", async () => {
    const mockClient = createMockMatrixClient({
      getJoinedRoomMembers: async () => ["@bot:example.org", "@user:example.org"],
    });

    expect(await isDMRoom(mockClient as never, "!room:example.org")).toBe(true);
  });

  it("returns true for 1-member rooms", async () => {
    const mockClient = createMockMatrixClient({
      getJoinedRoomMembers: async () => ["@bot:example.org"],
    });

    expect(await isDMRoom(mockClient as never, "!room:example.org")).toBe(true);
  });

  it("returns false for group rooms (>2 members)", async () => {
    const mockClient = createMockMatrixClient({
      getJoinedRoomMembers: async () => ["@bot:example.org", "@user1:example.org", "@user2:example.org"],
    });

    expect(await isDMRoom(mockClient as never, "!room:example.org")).toBe(false);
  });

  it("returns false on error", async () => {
    const mockClient = createMockMatrixClient({
      getJoinedRoomMembers: async () => {
        throw new Error("network error");
      },
    });

    expect(await isDMRoom(mockClient as never, "!room:example.org")).toBe(false);
  });
});
