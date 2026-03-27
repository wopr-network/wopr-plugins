import type { MatrixClient } from "matrix-bot-sdk";
import { logger } from "./logger.js";

function sanitize(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9_.-]/g, "");
}

/**
 * Generate a session key from a Matrix room.
 * Format:
 * - DMs: matrix:dm:username
 * - Rooms: matrix:room-name
 */
export async function getSessionKey(client: MatrixClient, roomId: string): Promise<string> {
  try {
    const members = await client.getJoinedRoomMembers(roomId);
    const botUserId = await client.getUserId();

    if (members.length === 2) {
      const otherUser = members.find((m) => m !== botUserId) || "unknown";
      const localpart = otherUser.split(":")[0]?.replace("@", "") || "unknown";
      return `matrix:dm:${sanitize(localpart)}`;
    }

    const roomName = await getRoomName(client, roomId);
    return `matrix:${sanitize(roomName)}`;
  } catch (err) {
    logger.warn({ msg: "Failed to resolve session key, using room ID", roomId, error: String(err) });
    return `matrix:${sanitize(roomId)}`;
  }
}

/**
 * Get the display name of a Matrix room.
 */
export async function getRoomName(client: MatrixClient, roomId: string): Promise<string> {
  try {
    const state = await client.getRoomStateEvent(roomId, "m.room.name", "");
    if (state?.name) return state.name as string;
  } catch {
    // Room may not have a name event
  }

  try {
    const state = await client.getRoomStateEvent(roomId, "m.room.canonical_alias", "");
    if (state?.alias) return (state.alias as string).split(":")[0]?.replace("#", "") || roomId;
  } catch {
    // No alias either
  }

  return roomId;
}

/**
 * Get the display name of a Matrix user.
 */
export async function getUserDisplayName(client: MatrixClient, userId: string, roomId?: string): Promise<string> {
  try {
    if (roomId) {
      const memberEvent = await client.getRoomStateEvent(roomId, "m.room.member", userId);
      if (memberEvent?.displayname) return memberEvent.displayname as string;
    }
    const profile = await client.getUserProfile(userId);
    if (profile?.displayname) return profile.displayname as string;
  } catch {
    // Ignore errors, fall back to localpart
  }

  return userId.split(":")[0]?.replace("@", "") || userId;
}

/**
 * Check if a room is a DM (direct message).
 */
export async function isDMRoom(client: MatrixClient, roomId: string): Promise<boolean> {
  try {
    const members = await client.getJoinedRoomMembers(roomId);
    return members.length <= 2;
  } catch {
    return false;
  }
}
