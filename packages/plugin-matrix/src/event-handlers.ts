import type { SessionResponseEvent, StreamMessage, WOPRPluginContext } from "@wopr-network/plugin-types";
import type { MatrixClient } from "matrix-bot-sdk";
import { saveAttachments } from "./attachments.js";
import { handleRegisteredCommand, handleRegisteredParsers } from "./channel-provider.js";
import type { QueuedInject, RoomQueueManager } from "./channel-queue.js";
import { logger } from "./logger.js";
import { getSessionKey, getUserDisplayName } from "./matrix-utils.js";
import { chunkMessage, formatMessage } from "./message-formatter.js";

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

/**
 * Execute an inject (called by the queue manager).
 */
export async function executeInjectInternal(
  item: QueuedInject,
  cancelToken: { cancelled: boolean },
  ctx: WOPRPluginContext,
  client: MatrixClient,
  queueManager: RoomQueueManager,
): Promise<void> {
  const { sessionKey, messageContent, authorDisplayName, roomId } = item;

  if (cancelToken.cancelled) {
    logger.info({ msg: "Inject cancelled before start", sessionKey });
    return;
  }

  await client.setTyping(roomId, true, 30000).catch(() => {});

  const state = queueManager.getSessionState(sessionKey);
  state.messageCount++;

  let fullResponse = "";

  try {
    logger.info({ msg: "Inject starting", sessionKey, from: authorDisplayName });

    await ctx.inject(sessionKey, messageContent, {
      from: authorDisplayName,
      channel: { type: "matrix", id: roomId, name: roomId },
      contextProviders: ["session_system", "skills", "bootstrap_files"],
      onStream: (msg: StreamMessage) => {
        if (cancelToken.cancelled) return;
        if (msg.type === "text" && msg.content) {
          fullResponse += msg.content;
        } else if (
          (msg.type as string) === "assistant" &&
          (msg as unknown as { message?: { content?: unknown } }).message?.content
        ) {
          const content = (msg as unknown as { message: { content: unknown } }).message.content;
          if (Array.isArray(content)) {
            fullResponse += content.map((c: unknown) => (c as { text?: string }).text || "").join("");
          } else if (typeof content === "string") {
            fullResponse += content;
          }
        }
        client.setTyping(roomId, true, 30000).catch(() => {});
      },
    });

    logger.info({ msg: "Inject complete", sessionKey });

    await client.setTyping(roomId, false).catch(() => {});

    if (!cancelToken.cancelled && fullResponse.trim()) {
      const chunks = chunkMessage(fullResponse);
      for (const chunk of chunks) {
        const msgContent = formatMessage(chunk);
        await client.sendMessage(roomId, msgContent);
      }
    }
  } catch (error: unknown) {
    const errorStr = String(error);
    const isCancelled =
      cancelToken.cancelled ||
      errorStr.toLowerCase().includes("cancelled") ||
      errorStr.toLowerCase().includes("canceled");

    await client.setTyping(roomId, false).catch(() => {});

    if (isCancelled) {
      logger.info({ msg: "Inject was cancelled", sessionKey });
    } else {
      logger.error({ msg: "Inject failed", sessionKey, error: errorStr });
    }
  }
}

/**
 * Handle an incoming Matrix room message event.
 */
export async function handleRoomMessage(
  roomId: string,
  event: MatrixRoomEvent,
  client: MatrixClient,
  ctx: WOPRPluginContext,
  queueManager: RoomQueueManager,
): Promise<void> {
  const botUserId = await client.getUserId();

  if (event.sender === botUserId) return;

  const msgtype = event.content?.msgtype;
  if (!msgtype) return;

  const body = event.content.body || "";

  const replyFn = async (msg: string) => {
    const msgContent = formatMessage(msg);
    await client.sendMessage(roomId, msgContent);
  };

  if (await handleRegisteredParsers(roomId, event.sender, body, replyFn)) {
    return;
  }

  if (await handleRegisteredCommand(roomId, event.sender, body, replyFn)) {
    return;
  }

  const authorDisplayName = await getUserDisplayName(client, event.sender, roomId);
  const sessionKey = await getSessionKey(client, roomId);

  try {
    ctx.logMessage(sessionKey, body, {
      from: authorDisplayName,
      channel: { type: "matrix", id: roomId, name: roomId },
    });
  } catch (_error: unknown) {}

  let isDM = false;
  try {
    const members = await client.getJoinedRoomMembers(roomId);
    isDM = members.length <= 2;
  } catch (_error: unknown) {
    isDM = false;
  }
  const botDisplayName = await getUserDisplayName(client, botUserId, roomId);
  const isMentioned = body.includes(botUserId) || body.toLowerCase().includes(botDisplayName.toLowerCase());

  if (!isDM && !isMentioned) {
    return;
  }

  let messageContent = body;

  if (isMentioned && !isDM) {
    messageContent = messageContent
      .replace(new RegExp(botUserId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"), "")
      .replace(new RegExp(botDisplayName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), "")
      .trim();
  }

  if (msgtype === "m.image" || msgtype === "m.file" || msgtype === "m.audio" || msgtype === "m.video") {
    const attachmentPaths = await saveAttachments(client, event);
    if (attachmentPaths.length > 0) {
      const attachmentInfo = attachmentPaths.map((p) => `[Attachment: ${p}]`).join("\n");
      messageContent = messageContent ? `${messageContent}\n\n${attachmentInfo}` : attachmentInfo;
    }
  }

  if (!messageContent) {
    messageContent = "Hello! (You mentioned me without a message)";
  }

  queueManager.queueInject(roomId, {
    sessionKey,
    messageContent,
    authorDisplayName,
    roomId,
    eventId: event.event_id,
    queuedAt: Date.now(),
  });
}

/**
 * Subscribe to session events for cross-channel inject delivery.
 * Returns an unsubscribe function to be called on shutdown.
 */
export function subscribeSessionEvents(ctx: WOPRPluginContext, _client: MatrixClient): (() => void) | undefined {
  if (!ctx.events) return undefined;

  const unsubscribe = ctx.events.on("session:afterInject", async (payload: SessionResponseEvent) => {
    if (!payload.session.startsWith("matrix:")) return;
    if ((payload as unknown as { channel?: { type: string } }).channel?.type === "matrix") return;

    if (payload.response) {
      logger.info({
        msg: "Cross-channel inject response for Matrix",
        session: payload.session,
        from: payload.from,
        responseLen: payload.response.length,
      });
    }
  });

  logger.info("Subscribed to session events for Matrix delivery");
  return unsubscribe;
}
