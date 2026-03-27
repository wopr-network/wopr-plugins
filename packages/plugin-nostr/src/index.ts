import type { ConfigSchema, WOPRPlugin, WOPRPluginContext } from "@wopr-network/plugin-types";
import { nostrChannelProvider, setBotNpub, setPublisher } from "./channel-provider.js";
import { derivePublicKey, formatNpub, parsePrivateKey } from "./crypto.js";
import { EventHandler } from "./event-handler.js";
import { EventPublisher } from "./event-publisher.js";
import { RelayPoolManager } from "./relay-pool.js";
import type { NostrConfig } from "./types.js";

let pluginCtx: WOPRPluginContext | null = null;
let poolManager: RelayPoolManager | null = null;
let subscription: { close(): void } | null = null;
const cleanups: Array<() => void> = [];

const DEFAULT_RELAYS = ["wss://relay.damus.io", "wss://relay.nostr.band", "wss://nos.lol", "wss://relay.snort.social"];

const configSchema: ConfigSchema = {
  title: "Nostr Integration",
  description: "Configure Nostr protocol integration",
  fields: [
    {
      name: "nsec",
      type: "password",
      label: "Private Key (nsec or hex)",
      placeholder: "nsec1...",
      required: true,
      description: "Your Nostr private key in nsec (bech32) or hex format",
      secret: true,
      setupFlow: "paste",
    },
    {
      name: "relays",
      type: "text",
      label: "Relay URLs",
      placeholder: "wss://relay.damus.io, wss://nos.lol",
      description: "Comma-separated list of relay WebSocket URLs",
    },
    {
      name: "commandPrefix",
      type: "text",
      label: "Command Prefix",
      placeholder: "!",
      description: "Prefix for commands in public notes",
    },
    {
      name: "enablePublicReplies",
      type: "boolean",
      label: "Enable Public Replies",
      description: "Respond to kind 1 notes that mention the bot",
    },
    {
      name: "dmPolicy",
      type: "select",
      label: "DM Policy",
      description: "Who can send DMs to the bot",
      options: [
        { value: "open", label: "Open (anyone)" },
        { value: "allowlist", label: "Allowlist only" },
        { value: "disabled", label: "Disabled" },
      ],
    },
    {
      name: "allowedPubkeys",
      type: "text",
      label: "Allowed Pubkeys",
      placeholder: "npub1..., npub1...",
      description: "Comma-separated pubkeys allowed to DM (when DM policy is allowlist)",
    },
  ],
};

const plugin: WOPRPlugin = {
  name: "@wopr-network/wopr-plugin-nostr",
  version: "1.0.0",
  description: "Nostr protocol integration for WOPR — encrypted DMs and public replies",

  manifest: {
    name: "@wopr-network/wopr-plugin-nostr",
    version: "1.0.0",
    description: "Nostr protocol integration for WOPR — encrypted DMs and public replies",
    capabilities: ["channel"],
    requires: {
      env: [],
      network: {
        outbound: true,
        hosts: ["relay.damus.io", "relay.nostr.band", "nos.lol", "relay.snort.social"],
      },
    },
    provides: {
      capabilities: [
        {
          type: "channel",
          id: "nostr",
          displayName: "Nostr",
        },
      ],
    },
    icon: "🟣",
    category: "communication",
    tags: ["nostr", "decentralized", "protocol", "social"],
    lifecycle: {
      shutdownBehavior: "drain",
      shutdownTimeoutMs: 10_000,
    },
    configSchema,
  },

  async init(ctx: WOPRPluginContext) {
    pluginCtx = ctx;
    ctx.registerConfigSchema("wopr-plugin-nostr", configSchema);
    cleanups.push(() => ctx.unregisterConfigSchema("wopr-plugin-nostr"));

    const config = ctx.getConfig<NostrConfig>();

    // 1. Parse private key
    let sk: Uint8Array;
    try {
      const nsecInput = config?.nsec ?? process.env.NOSTR_NSEC;
      if (!nsecInput) {
        ctx.log.warn("No Nostr private key configured. Run 'wopr configure --plugin nostr' to set up.");
        return;
      }
      sk = parsePrivateKey(nsecInput);
    } catch (error: unknown) {
      ctx.log.error("Invalid Nostr private key", error);
      return;
    }

    const pubkey = derivePublicKey(sk);
    const npub = formatNpub(pubkey);
    ctx.log.info(`Nostr bot pubkey: ${npub}`);

    // 2. Set up relay pool
    const relayUrls = config?.relays?.length ? config.relays : DEFAULT_RELAYS;
    poolManager = new RelayPoolManager(relayUrls, ctx.log);

    // 3. Create publisher
    const publisher = new EventPublisher(sk, poolManager, ctx.log);
    setPublisher(publisher);
    setBotNpub(npub);

    // 4. Create event handler
    const handler = new EventHandler(sk, config ?? {}, ctx, publisher);

    // 5. Subscribe to relevant events
    const filters: Array<{ kinds: number[]; "#p": string[]; since: number }> = [
      // Kind 4: encrypted DMs addressed to us
      { kinds: [4], "#p": [pubkey], since: Math.floor(Date.now() / 1000) },
    ];

    // Optionally subscribe to kind 1 mentions
    if (config?.enablePublicReplies) {
      filters.push({
        kinds: [1],
        "#p": [pubkey],
        since: Math.floor(Date.now() / 1000),
      });
    }

    subscription = poolManager.subscribe(filters, {
      onevent: (event: unknown) => {
        handler.handleEvent(event as Parameters<EventHandler["handleEvent"]>[0]).catch((error: unknown) => {
          pluginCtx?.log.error("Error handling Nostr event", error);
        });
      },
      oneose: () => {
        pluginCtx?.log.info("Caught up with relay events (EOSE)");
      },
    });

    // 6. Register channel provider
    ctx.registerChannelProvider(nostrChannelProvider);
    cleanups.push(() => ctx.unregisterChannelProvider("nostr"));
    ctx.log.info(`Nostr plugin initialized — listening on ${relayUrls.length} relays`);
  },

  async shutdown() {
    if (subscription) {
      subscription.close();
      subscription = null;
    }
    if (poolManager) {
      poolManager.close();
      poolManager = null;
    }
    setPublisher(null);
    for (const cleanup of cleanups) cleanup();
    cleanups.length = 0;
    pluginCtx = null;
  },
};

export default plugin;
