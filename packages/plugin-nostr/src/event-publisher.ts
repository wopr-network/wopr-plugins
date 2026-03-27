import { finalizeEvent } from "nostr-tools/pure";
import { encryptDM } from "./crypto.js";
import type { RelayPoolManager } from "./relay-pool.js";
import type { PluginLogger } from "./types.js";

export class EventPublisher {
  private sk: Uint8Array;
  private pool: RelayPoolManager;
  private log: PluginLogger;

  constructor(sk: Uint8Array, pool: RelayPoolManager, log: PluginLogger) {
    this.sk = sk;
    this.pool = pool;
    this.log = log;
  }

  /**
   * Publish a kind 1 (public text note) as a reply to an existing event.
   * Returns the new event ID.
   */
  async publishReply(content: string, parentEventId: string, parentPubkey: string): Promise<string> {
    const template = {
      kind: 1,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ["e", parentEventId, "", "reply"],
        ["p", parentPubkey],
      ],
      content,
    };
    const signedEvent = finalizeEvent(template, this.sk);
    this.log.info(`Publishing reply event ${signedEvent.id}`);
    await this.pool.publish(signedEvent);
    return signedEvent.id;
  }

  /**
   * Publish a kind 4 (encrypted DM) to a recipient.
   * Returns the new event ID.
   */
  async publishDM(content: string, recipientPubkey: string): Promise<string> {
    const ciphertext = await encryptDM(this.sk, recipientPubkey, content);
    const template = {
      kind: 4,
      created_at: Math.floor(Date.now() / 1000),
      tags: [["p", recipientPubkey]],
      content: ciphertext,
    };
    const signedEvent = finalizeEvent(template, this.sk);
    this.log.info(`Publishing DM event ${signedEvent.id}`);
    await this.pool.publish(signedEvent);
    return signedEvent.id;
  }
}
