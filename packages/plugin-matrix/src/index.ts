import type { ConfigSchema, WOPRPlugin, WOPRPluginContext } from "@wopr-network/plugin-types";
import type { MatrixClient } from "matrix-bot-sdk";
import { matrixChannelProvider, setCachedBotUsername, setChannelProviderClient } from "./channel-provider.js";
import { RoomQueueManager } from "./channel-queue.js";
import { executeInjectInternal, handleRoomMessage, subscribeSessionEvents } from "./event-handlers.js";
import { logger } from "./logger.js";
import { createMatrixClient } from "./matrix-client.js";
import { createMatrixExtension } from "./matrix-extension.js";
import { getUserDisplayName } from "./matrix-utils.js";
import {
  cleanupExpiredNotifications,
  clearAllPendingNotifications,
  handleReactionEvent,
  type MatrixReactionEvent,
} from "./notification-reactions.js";

interface MatrixRoomEvent {
  type: string;
  sender: string;
  event_id: string;
  room_id: string;
  origin_server_ts: number;
  content: {
    msgtype?: string;
    body?: string;
    formatted_body?: string;
    format?: string;
    url?: string;
    info?: { mimetype?: string; size?: number; w?: number; h?: number };
    "m.relates_to"?: { "m.in_reply_to"?: { event_id: string } };
  };
}

let client: MatrixClient | null = null;
let ctx: WOPRPluginContext | null = null;
let queueManager: RoomQueueManager | null = null;
let sessionUnsubscribe: (() => void) | undefined;
let cleanupInterval: ReturnType<typeof setInterval> | undefined;

const configSchema: ConfigSchema = {
  title: "Matrix Integration",
  description: "Configure Matrix bot integration with E2EE support",
  fields: [
    {
      name: "homeserverUrl",
      type: "text",
      label: "Homeserver URL",
      placeholder: "https://matrix.example.org",
      required: true,
      description: "Your Matrix homeserver URL (e.g., https://matrix.org)",
      setupFlow: "paste",
    },
    {
      name: "accessToken",
      type: "password",
      label: "Access Token",
      placeholder: "syt_...",
      description: "Bot access token (preferred over password login)",
      secret: true,
      setupFlow: "paste",
    },
    {
      name: "userId",
      type: "text",
      label: "Bot User ID",
      placeholder: "@bot:example.org",
      description: "Full Matrix user ID for the bot (e.g., @wopr:matrix.org)",
      setupFlow: "paste",
    },
    {
      name: "password",
      type: "password",
      label: "Password (alternative to token)",
      placeholder: "Bot account password",
      description: "Used for initial login if no access token is provided",
      secret: true,
      setupFlow: "paste",
    },
    {
      name: "enableEncryption",
      type: "checkbox",
      label: "Enable E2EE",
      default: true,
      description: "Enable end-to-end encryption for encrypted rooms",
      setupFlow: "none",
    },
    {
      name: "autoJoinRooms",
      type: "checkbox",
      label: "Auto-join Rooms",
      default: true,
      description: "Automatically join rooms when invited",
      setupFlow: "none",
    },
  ],
};

const plugin: WOPRPlugin = {
  name: "@wopr-network/wopr-plugin-matrix",
  version: "1.0.0",
  description: "Matrix bot with E2EE and rich text support",

  manifest: {
    name: "@wopr-network/wopr-plugin-matrix",
    version: "1.0.0",
    description: "Matrix channel plugin for WOPR - Enables AI conversations in Matrix rooms with E2EE support",
    author: "WOPR",
    license: "MIT",
    repository: "https://github.com/wopr-network/wopr-plugin-matrix",
    capabilities: ["channel", "messaging", "e2ee"],
    provides: {
      capabilities: [
        {
          type: "channel",
          id: "matrix",
          displayName: "Matrix",
          tier: "byok",
        },
      ],
    },
    requires: {
      network: { outbound: true },
      storage: { persistent: true, estimatedSize: "50MB" },
    },
    icon: "🔐",
    category: "communication",
    tags: ["matrix", "channel", "e2ee", "messaging", "decentralized"],
    lifecycle: {
      shutdownBehavior: "drain",
      shutdownTimeoutMs: 10_000,
    },
    configSchema,
  },

  async init(context: WOPRPluginContext) {
    ctx = context;
    ctx.registerConfigSchema("@wopr-network/wopr-plugin-matrix", configSchema);

    queueManager = new RoomQueueManager((item, cancelToken) => {
      if (!ctx || !client || !queueManager) return Promise.resolve();
      return executeInjectInternal(item, cancelToken, ctx, client, queueManager);
    });

    const config = ctx.getConfig<{
      homeserverUrl?: string;
      accessToken?: string;
      userId?: string;
      password?: string;
      enableEncryption?: boolean;
      autoJoinRooms?: boolean;
    }>();

    if (!config?.homeserverUrl) {
      logger.warn("Matrix plugin not configured: missing homeserverUrl");
      return;
    }

    if (!config.accessToken && !(config.userId && config.password)) {
      logger.warn("Matrix plugin not configured: need accessToken or userId+password");
      return;
    }

    try {
      const pluginDir = ctx.getPluginDir();
      client = await createMatrixClient({
        homeserverUrl: config.homeserverUrl,
        accessToken: config.accessToken,
        userId: config.userId,
        password: config.password,
        enableEncryption: config.enableEncryption,
        autoJoinRooms: config.autoJoinRooms,
        storageDir: pluginDir,
      });
    } catch (error: unknown) {
      logger.error({ msg: "Failed to create Matrix client", error: String(error) });
      throw error;
    }

    const botUserId = await client.getUserId();
    const botDisplayName = await getUserDisplayName(client, botUserId);
    setCachedBotUsername(botDisplayName);
    setChannelProviderClient(client);

    if (ctx.registerChannelProvider) {
      ctx.registerChannelProvider(matrixChannelProvider);
      logger.info("Registered Matrix channel provider");
    }

    const matrixExtension = createMatrixExtension(
      () => client,
      () => ctx,
      config.homeserverUrl,
    );
    if (ctx.registerExtension) {
      ctx.registerExtension("matrix", matrixExtension);
      logger.info("Registered Matrix extension");
    }

    sessionUnsubscribe = subscribeSessionEvents(ctx, client);

    client.on("room.message", (roomId: string, event: unknown) => {
      if (!client || !ctx || !queueManager) return;
      handleRoomMessage(roomId, event as MatrixRoomEvent, client, ctx, queueManager).catch((error: unknown) =>
        logger.error({ msg: "Room message handling failed", error: String(error) }),
      );
    });

    client.on("room.event", async (_roomId: string, event: unknown) => {
      if (!client) return;
      const evt = event as { type?: string; sender?: string; room_id?: string; content?: unknown };
      if (evt.type !== "m.reaction") return;
      const botUserId = await client.getUserId();
      handleReactionEvent(evt as MatrixReactionEvent, botUserId).catch((error: unknown) =>
        logger.error({ msg: "Reaction handling failed", error: String(error) }),
      );
    });

    client.on("room.failed_decryption", (roomId: string, _event: unknown, error: Error) => {
      logger.error({ msg: "Failed to decrypt message", roomId, error: String(error) });
    });

    try {
      await client.start();
      logger.info({ msg: "Matrix bot started", userId: botUserId, displayName: botDisplayName });
    } catch (error: unknown) {
      logger.error({ msg: "Matrix client start failed", error: String(error) });
      throw error;
    }

    cleanupInterval = setInterval(cleanupExpiredNotifications, 60_000);

    if (!config.accessToken && client.accessToken) {
      try {
        const { password: _omit, ...rest } = config;
        await ctx.saveConfig({
          ...rest,
          accessToken: client.accessToken,
        });
        logger.info("Saved access token from password login to config");
      } catch (error: unknown) {
        logger.warn({ msg: "Failed to save access token to config", error: String(error) });
      }
    }
  },

  async shutdown() {
    if (cleanupInterval !== undefined) {
      clearInterval(cleanupInterval);
      cleanupInterval = undefined;
    }
    clearAllPendingNotifications();
    if (sessionUnsubscribe) {
      sessionUnsubscribe();
      sessionUnsubscribe = undefined;
    }
    if (ctx?.unregisterConfigSchema) {
      ctx.unregisterConfigSchema("@wopr-network/wopr-plugin-matrix");
    }
    if (ctx?.unregisterChannelProvider) {
      ctx.unregisterChannelProvider("matrix");
    }
    if (ctx?.unregisterExtension) {
      ctx.unregisterExtension("matrix");
    }

    // Drain pending queue work before nulling client/queueManager.
    // This prevents in-flight injects from hitting a null client mid-execution.
    if (queueManager) {
      const drainTimeoutMs = 10_000;
      await Promise.race([queueManager.drain(), new Promise<void>((resolve) => setTimeout(resolve, drainTimeoutMs))]);
    }

    if (client) {
      client.stop();
      client = null;
    }
    setChannelProviderClient(null);
    queueManager = null;
    ctx = null;
    logger.info("Matrix plugin shut down");
  },
};

export default plugin;
