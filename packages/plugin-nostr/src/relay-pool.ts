import type { Filter } from "nostr-tools/filter";
import { SimplePool } from "nostr-tools/pool";
import type { NostrEvent, VerifiedEvent } from "nostr-tools/pure";
import type { PluginLogger, RelayStatus } from "./types.js";

type SubscribeCallbacks = {
  onevent: (event: unknown) => void;
  oneose?: () => void;
  onclose?: (reasons: string[]) => void;
};

export class RelayPoolManager {
  private pool: SimplePool;
  private relayUrls: string[];
  private statuses: Map<string, RelayStatus>;
  private log: PluginLogger;

  constructor(relayUrls: string[], log: PluginLogger) {
    this.pool = new SimplePool();
    this.relayUrls = relayUrls;
    this.log = log;
    this.statuses = new Map();
    for (const url of relayUrls) {
      this.statuses.set(url, { url, connected: false, reconnectAttempts: 0 });
    }
  }

  /** Get the underlying SimplePool instance */
  getPool(): SimplePool {
    return this.pool;
  }

  /** Get configured relay URLs */
  getRelayUrls(): string[] {
    return this.relayUrls;
  }

  /** Get status of all relays */
  getStatuses(): RelayStatus[] {
    return Array.from(this.statuses.values());
  }

  /**
   * Subscribe to events matching a filter across all relays.
   * Returns an object with a close() method.
   * For multiple filters, call subscribe once per filter or merge them.
   */
  subscribe(filters: Filter[], callbacks: SubscribeCallbacks): { close(): void } {
    // SimplePool.subscribe accepts a single Filter with an index signature,
    // so merge multiple filters by combining their properties if needed.
    // For MVP, subscribe once per filter and return a combined closer.
    const closers: Array<{ close: () => void }> = [];
    for (const filter of filters) {
      const closer = this.pool.subscribe(this.relayUrls, filter, {
        onevent: (event: NostrEvent) => callbacks.onevent(event),
        oneose: callbacks.oneose,
        onclose: callbacks.onclose,
      });
      closers.push(closer);
    }
    return {
      close() {
        for (const c of closers) c.close();
      },
    };
  }

  /**
   * Publish a signed event to all relays.
   * Resolves when at least one relay accepts it.
   */
  async publish(signedEvent: unknown): Promise<void> {
    const results = this.pool.publish(this.relayUrls, signedEvent as VerifiedEvent);
    try {
      await Promise.any(results);
    } catch (error: unknown) {
      this.log.error("Failed to publish event to any relay", error);
      throw new Error("Failed to publish event to any relay", { cause: error });
    }
  }

  /** Close all relay connections */
  close(): void {
    this.pool.close(this.relayUrls);
  }
}
