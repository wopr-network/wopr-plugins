import type {
  ChannelCommand,
  ChannelMessageParser,
  ChannelNotificationCallbacks,
  ChannelNotificationPayload,
  ChannelProvider,
} from "@wopr-network/plugin-types";
import type { EventPublisher } from "./event-publisher.js";

let publisher: EventPublisher | null = null;
let botNpub = "unknown";

export function setPublisher(p: EventPublisher | null): void {
  publisher = p;
}

export function setBotNpub(npub: string): void {
  botNpub = npub;
}

export function getBotNpub(): string {
  return botNpub;
}

const registeredCommands = new Map<string, ChannelCommand>();
const registeredParsers = new Map<string, ChannelMessageParser>();

export const nostrChannelProvider: ChannelProvider = {
  id: "nostr",

  registerCommand(cmd: ChannelCommand): void {
    registeredCommands.set(cmd.name, cmd);
  },

  unregisterCommand(name: string): void {
    registeredCommands.delete(name);
  },

  getCommands(): ChannelCommand[] {
    return Array.from(registeredCommands.values());
  },

  addMessageParser(parser: ChannelMessageParser): void {
    registeredParsers.set(parser.id, parser);
  },

  removeMessageParser(id: string): void {
    registeredParsers.delete(id);
  },

  getMessageParsers(): ChannelMessageParser[] {
    return Array.from(registeredParsers.values());
  },

  async send(channelId: string, content: string): Promise<void> {
    if (!publisher) throw new Error("Nostr publisher not initialized");

    if (channelId.startsWith("dm:")) {
      const recipientPubkey = channelId.slice(3);
      await publisher.publishDM(content, recipientPubkey);
    } else {
      throw new Error(`Unsupported Nostr channel format: ${channelId}`);
    }
  },

  getBotUsername(): string {
    return botNpub;
  },

  async sendNotification(
    channelId: string,
    payload: ChannelNotificationPayload,
    callbacks?: ChannelNotificationCallbacks,
  ): Promise<void> {
    if (payload.type !== "friend-request") return;
    if (!channelId.startsWith("dm:")) return;
    if (!publisher) throw new Error("Nostr publisher not initialized");

    const recipientPubkey = channelId.slice(3);
    const from = payload.from ?? "someone";
    const message = `Friend request from ${from}. Reply ACCEPT or DENY.`;

    await publisher.publishDM(message, recipientPubkey);

    if (!callbacks?.onAccept && !callbacks?.onDeny) return;

    const parserId = `notif-friend-request-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const cleanup = () => {
      nostrChannelProvider.removeMessageParser(parserId);
      clearTimeout(timer);
    };

    const timer = setTimeout(cleanup, 5 * 60 * 1000);

    const parser: ChannelMessageParser = {
      id: parserId,
      pattern: (msg: string) => /^\s*(accept|deny)\s*$/i.test(msg),
      handler: async (ctx) => {
        // Guard: only process from the intended channel and recipient
        if (ctx.channel !== channelId) return;
        if (ctx.sender !== recipientPubkey) return;
        const normalized = ctx.content.trim().toUpperCase();
        if (normalized === "ACCEPT") {
          cleanup();
          await callbacks?.onAccept?.();
        } else if (normalized === "DENY") {
          cleanup();
          await callbacks?.onDeny?.();
        }
      },
    };

    nostrChannelProvider.addMessageParser(parser);
  },
};
