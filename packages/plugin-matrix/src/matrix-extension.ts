import type { WOPRPluginContext } from "@wopr-network/plugin-types";
import type { MatrixClient } from "matrix-bot-sdk";
import { logger } from "./logger.js";

export interface MatrixStatusInfo {
  online: boolean;
  userId: string;
  joinedRooms: number;
  homeserver: string;
}

export interface MatrixRoomInfo {
  roomId: string;
  name: string;
  memberCount: number;
  encrypted: boolean;
}

export interface MatrixExtension {
  getBotUserId: () => Promise<string>;
  getStatus: () => Promise<MatrixStatusInfo>;
  listRooms: () => Promise<MatrixRoomInfo[]>;
}

export function createMatrixExtension(
  getClient: () => MatrixClient | null,
  _getCtx: () => WOPRPluginContext | null,
  homeserverUrl: string,
): MatrixExtension {
  return {
    getBotUserId: async (): Promise<string> => {
      const client = getClient();
      if (!client) return "unknown";
      return client.getUserId();
    },

    getStatus: async (): Promise<MatrixStatusInfo> => {
      const client = getClient();
      if (!client) {
        return { online: false, userId: "unknown", joinedRooms: 0, homeserver: homeserverUrl };
      }
      try {
        const userId = await client.getUserId();
        const rooms = await client.getJoinedRooms();
        return {
          online: true,
          userId,
          joinedRooms: rooms.length,
          homeserver: homeserverUrl,
        };
      } catch {
        return { online: false, userId: "unknown", joinedRooms: 0, homeserver: homeserverUrl };
      }
    },

    listRooms: async (): Promise<MatrixRoomInfo[]> => {
      const client = getClient();
      if (!client) return [];
      try {
        const roomIds = await client.getJoinedRooms();
        const rooms: MatrixRoomInfo[] = [];

        for (const roomId of roomIds) {
          let name = roomId;
          let encrypted = false;
          let memberCount = 0;

          try {
            const nameEvent = await client.getRoomStateEvent(roomId, "m.room.name", "");
            if (nameEvent?.name) name = nameEvent.name as string;
          } catch {
            /* no name set */
          }

          try {
            await client.getRoomStateEvent(roomId, "m.room.encryption", "");
            encrypted = true;
          } catch {
            /* not encrypted */
          }

          try {
            const members = await client.getJoinedRoomMembers(roomId);
            memberCount = members.length;
          } catch {
            /* ignore */
          }

          rooms.push({ roomId, name, memberCount, encrypted });
        }

        return rooms;
      } catch (err) {
        logger.error({ msg: "Failed to list rooms", error: String(err) });
        return [];
      }
    },
  };
}
