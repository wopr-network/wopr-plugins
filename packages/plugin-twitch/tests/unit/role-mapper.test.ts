import { describe, it, expect } from "vitest";
import { extractUserInfo, getRolePrefix } from "../../src/role-mapper.js";

const baseUserInfo = {
  isMod: false,
  isSubscriber: false,
  isVip: false,
  isBroadcaster: false,
  badges: new Map<string, string>(),
  color: undefined,
};

describe("extractUserInfo", () => {
  it("maps all fields correctly", () => {
    const result = extractUserInfo("123", "testuser", "TestUser", {
      ...baseUserInfo,
      isMod: true,
      color: "#FF0000",
    });

    expect(result.userId).toBe("123");
    expect(result.username).toBe("testuser");
    expect(result.displayName).toBe("TestUser");
    expect(result.isMod).toBe(true);
    expect(result.isSubscriber).toBe(false);
    expect(result.color).toBe("#FF0000");
  });
});

describe("getRolePrefix", () => {
  it("returns just displayName when user has no roles", () => {
    const info = extractUserInfo("1", "user", "RegularUser", baseUserInfo);
    expect(getRolePrefix(info)).toBe("RegularUser");
  });

  it("returns [Broadcaster] prefix for broadcaster", () => {
    const info = extractUserInfo("1", "streamer", "Streamer", { ...baseUserInfo, isBroadcaster: true });
    expect(getRolePrefix(info)).toBe("[Broadcaster] Streamer");
  });

  it("returns [Mod] prefix for moderator", () => {
    const info = extractUserInfo("1", "mod", "ModUser", { ...baseUserInfo, isMod: true });
    expect(getRolePrefix(info)).toBe("[Mod] ModUser");
  });

  it("returns [VIP] prefix for VIP", () => {
    const info = extractUserInfo("1", "vip", "VIPUser", { ...baseUserInfo, isVip: true });
    expect(getRolePrefix(info)).toBe("[VIP] VIPUser");
  });

  it("returns [Sub] prefix for subscriber", () => {
    const info = extractUserInfo("1", "sub", "SubUser", { ...baseUserInfo, isSubscriber: true });
    expect(getRolePrefix(info)).toBe("[Sub] SubUser");
  });

  it("returns [Mod/Sub] for moderator + subscriber", () => {
    const info = extractUserInfo("1", "modsub", "ModSub", { ...baseUserInfo, isMod: true, isSubscriber: true });
    expect(getRolePrefix(info)).toBe("[Mod/Sub] ModSub");
  });

  it("returns [Broadcaster/Mod/VIP/Sub] for all roles", () => {
    const info = extractUserInfo("1", "all", "AllRoles", {
      ...baseUserInfo,
      isBroadcaster: true,
      isMod: true,
      isVip: true,
      isSubscriber: true,
    });
    expect(getRolePrefix(info)).toBe("[Broadcaster/Mod/VIP/Sub] AllRoles");
  });
});
