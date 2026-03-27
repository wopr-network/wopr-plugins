import type { TwitchUserInfo } from "./types.js";

/**
 * Extract user info from Twurple message userInfo fields.
 */
export function extractUserInfo(
  userId: string,
  userName: string,
  displayName: string,
  userInfo: {
    isMod: boolean;
    isSubscriber: boolean;
    isVip: boolean;
    isBroadcaster: boolean;
    badges: Map<string, string>;
    color?: string;
  },
): TwitchUserInfo {
  return {
    userId,
    username: userName,
    displayName,
    isMod: userInfo.isMod,
    isSubscriber: userInfo.isSubscriber,
    isVip: userInfo.isVip,
    isBroadcaster: userInfo.isBroadcaster,
    badges: userInfo.badges,
    color: userInfo.color,
  };
}

/**
 * Build a role prefix string for message injection context.
 * E.g., "[Broadcaster/Mod] DisplayName"
 */
export function getRolePrefix(info: TwitchUserInfo): string {
  const roles: string[] = [];
  if (info.isBroadcaster) roles.push("Broadcaster");
  if (info.isMod) roles.push("Mod");
  if (info.isVip) roles.push("VIP");
  if (info.isSubscriber) roles.push("Sub");
  if (roles.length === 0) return info.displayName;
  return `[${roles.join("/")}] ${info.displayName}`;
}
