import { logger } from "./logger.js";

export const ACCEPT_EMOJI = "\u2705";
export const DENY_EMOJI = "\u274C";
export const NOTIFICATION_TTL_MS = 15 * 60 * 1000;

export interface PendingNotification {
  eventId: string;
  roomId: string;
  callbacks: {
    onAccept?: () => Promise<void>;
    onDeny?: () => Promise<void>;
  };
  timestamp: number;
}

const pendingNotifications = new Map<string, PendingNotification>();

export function storePendingNotification(
  eventId: string,
  roomId: string,
  callbacks: { onAccept?: () => Promise<void>; onDeny?: () => Promise<void> },
): void {
  pendingNotifications.set(eventId, {
    eventId,
    roomId,
    callbacks,
    timestamp: Date.now(),
  });
}

export function getPendingNotification(eventId: string): PendingNotification | undefined {
  return pendingNotifications.get(eventId);
}

export function removePendingNotification(eventId: string): void {
  pendingNotifications.delete(eventId);
}

export function clearAllPendingNotifications(): void {
  pendingNotifications.clear();
}

export interface MatrixReactionEvent {
  type: string;
  sender: string;
  room_id: string;
  content: {
    "m.relates_to"?: {
      rel_type?: string;
      event_id?: string;
      key?: string;
    };
  };
}

export async function handleReactionEvent(event: MatrixReactionEvent, botUserId: string): Promise<void> {
  if (event.sender === botUserId) return;

  const relatesTo = event.content?.["m.relates_to"];
  if (!relatesTo || relatesTo.rel_type !== "m.annotation") return;

  const targetEventId = relatesTo.event_id;
  const emoji = relatesTo.key;
  if (!targetEventId || !emoji) return;

  const pending = pendingNotifications.get(targetEventId);
  if (!pending) return;

  if (pending.roomId && event.room_id !== pending.roomId) return;

  const normalizedKey = emoji.replace(/\uFE0F/g, "");

  if (normalizedKey !== ACCEPT_EMOJI && normalizedKey !== DENY_EMOJI) return;

  // Remove immediately to prevent double-firing
  pendingNotifications.delete(targetEventId);

  try {
    if (normalizedKey === ACCEPT_EMOJI && pending.callbacks.onAccept) {
      await pending.callbacks.onAccept();
    } else if (normalizedKey === DENY_EMOJI && pending.callbacks.onDeny) {
      await pending.callbacks.onDeny();
    }
  } catch (error) {
    logger.error({
      msg: "Notification callback failed",
      eventId: targetEventId,
      action: normalizedKey === ACCEPT_EMOJI ? "accept" : "deny",
      error: String(error),
    });
  }
}

export function cleanupExpiredNotifications(): void {
  const now = Date.now();
  for (const [key, notification] of pendingNotifications) {
    if (now - notification.timestamp > NOTIFICATION_TTL_MS) {
      pendingNotifications.delete(key);
    }
  }
}
