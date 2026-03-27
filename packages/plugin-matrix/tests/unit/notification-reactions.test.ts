import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ACCEPT_EMOJI,
  DENY_EMOJI,
  NOTIFICATION_TTL_MS,
  cleanupExpiredNotifications,
  clearAllPendingNotifications,
  getPendingNotification,
  handleReactionEvent,
  storePendingNotification,
} from "../../src/notification-reactions.js";

describe("notification-reactions", () => {
  beforeEach(() => {
    clearAllPendingNotifications();
  });

  describe("storePendingNotification", () => {
    it("stores and retrieves a pending notification by eventId", () => {
      const callbacks = { onAccept: vi.fn(), onDeny: vi.fn() };
      storePendingNotification("$evt1", "!room:x", callbacks);
      const pending = getPendingNotification("$evt1");
      expect(pending).toBeDefined();
      expect(pending!.roomId).toBe("!room:x");
      expect(pending!.eventId).toBe("$evt1");
    });

    it("returns undefined for unknown eventId", () => {
      expect(getPendingNotification("$unknown")).toBeUndefined();
    });
  });

  describe("handleReactionEvent", () => {
    it("fires onAccept when accept emoji is reacted", async () => {
      const onAccept = vi.fn().mockResolvedValue(undefined);
      const onDeny = vi.fn().mockResolvedValue(undefined);
      storePendingNotification("$evt1", "!room:x", { onAccept, onDeny });

      await handleReactionEvent(
        {
          type: "m.reaction",
          sender: "@owner:x",
          room_id: "!room:x",
          content: {
            "m.relates_to": {
              rel_type: "m.annotation",
              event_id: "$evt1",
              key: ACCEPT_EMOJI,
            },
          },
        },
        "@bot:x",
      );

      expect(onAccept).toHaveBeenCalledOnce();
      expect(onDeny).not.toHaveBeenCalled();
      expect(getPendingNotification("$evt1")).toBeUndefined();
    });

    it("fires onDeny when deny emoji is reacted", async () => {
      const onAccept = vi.fn().mockResolvedValue(undefined);
      const onDeny = vi.fn().mockResolvedValue(undefined);
      storePendingNotification("$evt1", "!room:x", { onAccept, onDeny });

      await handleReactionEvent(
        {
          type: "m.reaction",
          sender: "@owner:x",
          room_id: "!room:x",
          content: {
            "m.relates_to": {
              rel_type: "m.annotation",
              event_id: "$evt1",
              key: DENY_EMOJI,
            },
          },
        },
        "@bot:x",
      );

      expect(onDeny).toHaveBeenCalledOnce();
      expect(onAccept).not.toHaveBeenCalled();
      expect(getPendingNotification("$evt1")).toBeUndefined();
    });

    it("ignores reactions from the bot itself", async () => {
      const onAccept = vi.fn().mockResolvedValue(undefined);
      storePendingNotification("$evt1", "!room:x", { onAccept });

      await handleReactionEvent(
        {
          type: "m.reaction",
          sender: "@bot:x",
          room_id: "!room:x",
          content: {
            "m.relates_to": {
              rel_type: "m.annotation",
              event_id: "$evt1",
              key: ACCEPT_EMOJI,
            },
          },
        },
        "@bot:x",
      );

      expect(onAccept).not.toHaveBeenCalled();
      expect(getPendingNotification("$evt1")).toBeDefined();
    });

    it("ignores reactions on unknown event IDs", async () => {
      await handleReactionEvent(
        {
          type: "m.reaction",
          sender: "@owner:x",
          room_id: "!room:x",
          content: {
            "m.relates_to": {
              rel_type: "m.annotation",
              event_id: "$unknown",
              key: ACCEPT_EMOJI,
            },
          },
        },
        "@bot:x",
      );
      // No error thrown
    });

    it("ignores unrelated emoji reactions", async () => {
      const onAccept = vi.fn().mockResolvedValue(undefined);
      storePendingNotification("$evt1", "!room:x", { onAccept });

      await handleReactionEvent(
        {
          type: "m.reaction",
          sender: "@owner:x",
          room_id: "!room:x",
          content: {
            "m.relates_to": {
              rel_type: "m.annotation",
              event_id: "$evt1",
              key: "\uD83D\uDC4D",
            },
          },
        },
        "@bot:x",
      );

      expect(onAccept).not.toHaveBeenCalled();
      expect(getPendingNotification("$evt1")).toBeDefined();
    });

    it("logs and swallows callback errors", async () => {
      const onAccept = vi.fn().mockRejectedValue(new Error("boom"));
      storePendingNotification("$evt1", "!room:x", { onAccept });

      await handleReactionEvent(
        {
          type: "m.reaction",
          sender: "@owner:x",
          room_id: "!room:x",
          content: {
            "m.relates_to": {
              rel_type: "m.annotation",
              event_id: "$evt1",
              key: ACCEPT_EMOJI,
            },
          },
        },
        "@bot:x",
      );

      expect(onAccept).toHaveBeenCalled();
      // Notification removed even on error
      expect(getPendingNotification("$evt1")).toBeUndefined();
    });
  });

  describe("cleanupExpiredNotifications", () => {
    it("removes notifications older than TTL", () => {
      storePendingNotification("$old", "!room:x", {});
      // Manually backdate
      const pending = getPendingNotification("$old")!;
      pending.timestamp = Date.now() - NOTIFICATION_TTL_MS - 1;

      storePendingNotification("$new", "!room:x", {});

      cleanupExpiredNotifications();

      expect(getPendingNotification("$old")).toBeUndefined();
      expect(getPendingNotification("$new")).toBeDefined();
    });
  });
});
