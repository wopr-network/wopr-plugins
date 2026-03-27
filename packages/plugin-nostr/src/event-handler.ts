import * as nip19 from "nostr-tools/nip19";
import { verifyEvent } from "nostr-tools/pure";
import { nostrChannelProvider } from "./channel-provider.js";
import { decryptDM, derivePublicKey, formatNpub } from "./crypto.js";
import type { EventPublisher } from "./event-publisher.js";
import type { NostrConfig, NostrEvent, WOPRPluginContext } from "./types.js";

export class EventHandler {
  private sk: Uint8Array;
  private pubkey: string;
  private config: NostrConfig;
  private ctx: WOPRPluginContext;
  private publisher: EventPublisher;

  constructor(sk: Uint8Array, config: NostrConfig, ctx: WOPRPluginContext, publisher: EventPublisher) {
    this.sk = sk;
    this.pubkey = derivePublicKey(sk);
    this.config = config;
    this.ctx = ctx;
    this.publisher = publisher;
  }

  /**
   * Handle an incoming Nostr event. Dispatches to handleDM or handleMention.
   */
  async handleEvent(event: NostrEvent): Promise<void> {
    // Verify event signature
    if (!verifyEvent(event)) {
      this.ctx.log.warn(`Dropping event ${event.id}: invalid signature`);
      return;
    }

    // Self-event loop prevention
    if (event.pubkey === this.pubkey) {
      return;
    }

    // Kind 4: encrypted DM addressed to us
    if (event.kind === 4) {
      const pTag = event.tags.find((t) => t[0] === "p" && t[1] === this.pubkey);
      if (pTag) {
        await this.handleDM(event);
      }
      return;
    }

    // Kind 1: public text note mentioning us
    if (event.kind === 1 && this.config.enablePublicReplies) {
      const pTag = event.tags.find((t) => t[0] === "p" && t[1] === this.pubkey);
      if (pTag) {
        await this.handleMention(event);
      }
    }
  }

  /**
   * Handle a kind 4 encrypted DM.
   */
  private async handleDM(event: NostrEvent): Promise<void> {
    if (!this.isAllowed(event.pubkey)) {
      this.ctx.log.info(`Rejecting DM from ${event.pubkey}: not in allowlist`);
      return;
    }

    let plaintext: string;
    try {
      plaintext = await decryptDM(this.sk, event.pubkey, event.content);
    } catch (error: unknown) {
      this.ctx.log.error(`Failed to decrypt DM from ${event.pubkey}`, error);
      return;
    }

    const channelId = `dm:${event.pubkey}`;
    const npub = formatNpub(event.pubkey);
    const sessionKey = `nostr-dm-${event.pubkey}`;
    const channelRef = { type: "nostr", id: channelId, name: "Nostr DM" };

    this.ctx.logMessage(sessionKey, plaintext, { from: npub, channel: channelRef });

    // Check registered message parsers before falling through to LLM injection
    const parsers = nostrChannelProvider.getMessageParsers();
    for (const parser of parsers) {
      const matched = parser.pattern instanceof RegExp ? parser.pattern.test(plaintext) : parser.pattern(plaintext);
      if (matched) {
        await parser.handler({
          channel: channelId,
          channelType: "nostr",
          sender: event.pubkey,
          content: plaintext,
          reply: async (msg: string) => {
            await this.publisher.publishDM(msg, event.pubkey);
          },
          getBotUsername: () => nostrChannelProvider.getBotUsername(),
        });
        return; // consumed by parser — skip LLM injection
      }
    }

    let response: string;
    try {
      response = await this.ctx.inject(sessionKey, `[${npub}]: ${plaintext}`, {
        from: npub,
        channel: channelRef,
      });
    } catch (error: unknown) {
      this.ctx.log.error(`Failed to inject DM from ${npub}`, error);
      return;
    }

    await this.publisher.publishDM(response, event.pubkey);
  }

  /**
   * Handle a kind 1 public note that mentions our pubkey.
   */
  private async handleMention(event: NostrEvent): Promise<void> {
    const npub = formatNpub(event.pubkey);
    const sessionKey = `nostr-public-${event.pubkey}`;
    const channelId = `public:${event.id}`;
    const channelRef = { type: "nostr", id: channelId, name: "Nostr Public" };

    // Strip our own mention from the content if present
    const ourNpub = formatNpub(this.pubkey);
    const cleanContent = event.content.replace(new RegExp(`nostr:${ourNpub}|@${ourNpub}`, "g"), "").trim();

    let response: string;
    try {
      response = await this.ctx.inject(sessionKey, `[${npub}]: ${cleanContent}`, {
        from: npub,
        channel: channelRef,
      });
    } catch (error: unknown) {
      this.ctx.log.error(`Failed to inject mention from ${npub}`, error);
      return;
    }

    await this.publisher.publishReply(response, event.id, event.pubkey);
  }

  /**
   * Check if a pubkey is allowed to send DMs.
   */
  private isAllowed(pubkey: string): boolean {
    const policy = this.config.dmPolicy ?? "open";

    if (policy === "open") return true;
    if (policy === "disabled") return false;

    // allowlist
    const allowed = this.config.allowedPubkeys ?? [];
    return allowed.some((entry) => {
      if (entry === pubkey) return true;
      // Try decoding npub
      try {
        const decoded = nip19.decode(entry);
        if (decoded.type === "npub") {
          return decoded.data === pubkey;
        }
      } catch {
        // Not a valid bech32 — skip
      }
      return false;
    });
  }
}
