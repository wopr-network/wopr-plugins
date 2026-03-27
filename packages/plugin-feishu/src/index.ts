import http from "node:http";
import path from "node:path";
import * as lark from "@larksuiteoapi/node-sdk";
import type {
  AgentIdentity,
  ChannelCommand,
  ChannelMessageParser,
  ChannelNotificationCallbacks,
  ChannelNotificationPayload,
  ChannelProvider,
  ConfigSchema,
  WOPRPlugin,
  WOPRPluginContext,
} from "@wopr-network/plugin-types";
import winston from "winston";
import type { FeishuConfig } from "./types.js";

// ─── Plugin-local types ───────────────────────────────────────────────────────

interface ChannelInfo {
  type: string;
  id: string;
  name?: string;
}

// ─── Module-level state ───────────────────────────────────────────────────────

let ctx: WOPRPluginContext | null = null;
let config: FeishuConfig = {};
let agentIdentity: AgentIdentity = { name: "WOPR", emoji: "👀" };
let client: lark.Client | null = null;
let wsClient: lark.WSClient | null = null;
let httpServer: http.Server | null = null;
let isShuttingDown = false;
let logger: winston.Logger;

// ─── Pending callbacks for friend-request notifications ───────────────────────

export interface PendingCallbacks {
  onAccept?: () => Promise<void>;
  onDeny?: () => Promise<void>;
  timestamp: number;
}

const pendingCallbacks: Map<string, PendingCallbacks> = new Map();
const NOTIFICATION_TTL_MS = 15 * 60 * 1000;
let cleanupInterval: ReturnType<typeof setInterval> | null = null;

export function storePendingCallbacks(key: string, entry: PendingCallbacks): void {
  pendingCallbacks.set(key, entry);
}

export function getPendingCallbacks(key: string): PendingCallbacks | undefined {
  return pendingCallbacks.get(key);
}

export function removePendingCallbacks(key: string): PendingCallbacks | undefined {
  const entry = pendingCallbacks.get(key);
  pendingCallbacks.delete(key);
  return entry;
}

export function cleanupExpiredNotifications(): void {
  const now = Date.now();
  for (const [key, entry] of pendingCallbacks) {
    if (now - entry.timestamp > NOTIFICATION_TTL_MS) {
      pendingCallbacks.delete(key);
    }
  }
}

// ─── Logger ───────────────────────────────────────────────────────────────────

function initLogger(): winston.Logger {
  const logsDir = path.join(process.env.WOPR_HOME ?? process.env.HOME ?? ".", "logs");
  return winston.createLogger({
    level: "info",
    defaultMeta: { service: "wopr-plugin-feishu" },
    transports: [
      new winston.transports.Console({
        format: winston.format.combine(winston.format.timestamp(), winston.format.simple()),
      }),
      new winston.transports.File({
        filename: path.join(logsDir, "feishu-plugin-error.log"),
        level: "error",
        format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
      }),
      new winston.transports.File({
        filename: path.join(logsDir, "feishu-plugin.log"),
        format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
      }),
    ],
  });
}

// ─── Config Schema ────────────────────────────────────────────────────────────

const configSchema: ConfigSchema = {
  title: "Feishu/Lark Plugin",
  description: "Configure Feishu/Lark bot integration",
  fields: [
    {
      name: "appId",
      type: "password",
      label: "App ID",
      placeholder: "cli_xxx",
      required: true,
      secret: true,
      setupFlow: "paste",
      description: "Feishu App ID from Developer Console",
    },
    {
      name: "appSecret",
      type: "password",
      label: "App Secret",
      placeholder: "xxx",
      required: true,
      secret: true,
      setupFlow: "paste",
      description: "Feishu App Secret from Developer Console",
    },
    {
      name: "domain",
      type: "select",
      label: "Domain",
      options: [
        { value: "feishu", label: "Feishu (China)" },
        { value: "lark", label: "Lark (International)" },
      ],
      default: "feishu",
      setupFlow: "interactive",
      description: "feishu for China, lark for international",
    },
    {
      name: "mode",
      type: "select",
      label: "Connection Mode",
      options: [
        { value: "websocket", label: "WebSocket (no public URL needed)" },
        { value: "webhook", label: "Webhook (HTTP)" },
      ],
      default: "websocket",
      setupFlow: "interactive",
      description: "WebSocket needs no public URL; Webhook requires one",
    },
    {
      name: "encryptKey",
      type: "password",
      label: "Encrypt Key",
      secret: true,
      description: "Event encryption key (webhook mode only)",
    },
    {
      name: "verificationToken",
      type: "password",
      label: "Verification Token",
      secret: true,
      description: "Event verification token (webhook mode only)",
    },
    {
      name: "botName",
      type: "text",
      label: "Bot Name",
      description: "Bot display name, used for mention stripping in groups",
    },
    {
      name: "webhookPort",
      type: "number",
      label: "Webhook Port",
      default: 3000,
      description: "Port for webhook HTTP server",
    },
    {
      name: "dmPolicy",
      type: "select",
      label: "DM Policy",
      options: [
        { value: "open", label: "Open (respond to all DMs)" },
        { value: "disabled", label: "Disabled" },
      ],
      default: "open",
      description: "How to handle direct messages",
    },
    {
      name: "groupPolicy",
      type: "select",
      label: "Group Policy",
      options: [
        { value: "mention", label: "Respond only when mentioned" },
        { value: "all", label: "Respond to all messages" },
        { value: "disabled", label: "Disabled" },
      ],
      default: "mention",
      description: "How to handle group chat messages",
    },
    {
      name: "useRichCards",
      type: "boolean",
      label: "Use Rich Cards",
      default: true,
      description: "Send responses as interactive message cards",
    },
    {
      name: "cardHeaderColor",
      type: "text",
      label: "Card Header Color",
      default: "blue",
      description: "Card header template color (e.g. blue, green, red)",
    },
  ],
};

// ─── Channel Provider ─────────────────────────────────────────────────────────

const feishuChannelProvider: ChannelProvider = {
  id: "feishu",

  registerCommand(_cmd: ChannelCommand): void {
    // Commands registered externally — no-op for feishu (no slash command registry)
  },
  unregisterCommand(_name: string): void {},
  getCommands(): ChannelCommand[] {
    return [];
  },
  addMessageParser(_parser: ChannelMessageParser): void {},
  removeMessageParser(_id: string): void {},
  getMessageParsers(): ChannelMessageParser[] {
    return [];
  },

  async send(channel: string, content: string): Promise<void> {
    await sendResponse(channel, content);
  },

  getBotUsername(): string {
    return config.botName ?? agentIdentity.name ?? "WOPR";
  },

  async sendNotification(
    channelId: string,
    payload: ChannelNotificationPayload,
    callbacks: ChannelNotificationCallbacks = {},
  ): Promise<void> {
    if (!channelId) throw new Error("sendNotification: owner user ID not configured");
    if (payload.type !== "friend-request") return;
    if (!client) return;

    const requestKey = `req_${payload.from ?? "unknown"}_${crypto.randomUUID().slice(0, 8)}`;

    storePendingCallbacks(requestKey, {
      onAccept: callbacks.onAccept,
      onDeny: callbacks.onDeny,
      timestamp: Date.now(),
    });

    const cardContent = {
      config: { wide_screen_mode: true },
      header: {
        template: "blue",
        title: { content: "Friend Request", tag: "plain_text" },
      },
      elements: [
        {
          tag: "markdown",
          content: `**${payload.from ?? "Unknown"}** wants to be your friend!${payload.channelName ? `\nChannel: ${payload.channelName}` : ""}${payload.pubkey ? `\nPubkey: \`${String(payload.pubkey).slice(0, 16)}...\`` : ""}`,
        },
        {
          tag: "action",
          actions: [
            {
              tag: "button",
              text: { tag: "plain_text", content: "Accept" },
              type: "primary",
              value: { key: requestKey, action: "accept" },
            },
            {
              tag: "button",
              text: { tag: "plain_text", content: "Deny" },
              type: "danger",
              value: { key: requestKey, action: "deny" },
            },
          ],
        },
      ],
    };

    try {
      await client.im.message.create({
        params: { receive_id_type: "chat_id" },
        data: {
          receive_id: channelId,
          content: JSON.stringify(cardContent),
          msg_type: "interactive",
        },
      });
      logger.info("Sent friend request notification card", {
        channelId,
        from: payload.from,
      });
    } catch (err: unknown) {
      logger.error("Failed to send notification card", { channelId, err });
      pendingCallbacks.delete(requestKey);
    }
  },
};

// ─── Identity ─────────────────────────────────────────────────────────────────

async function refreshIdentity(): Promise<void> {
  if (!ctx) return;
  try {
    const identity = await ctx.getAgentIdentity();
    agentIdentity = { ...agentIdentity, ...identity };
  } catch (err: unknown) {
    logger.warn("Failed to refresh agent identity", { err });
  }
}

// ─── Domain / Credentials ─────────────────────────────────────────────────────

export function resolveDomain(cfg: FeishuConfig): number {
  if (cfg.domain === "lark") return lark.Domain.Lark;
  return lark.Domain.Feishu;
}

export function resolveCredentials(cfg: FeishuConfig = config): {
  appId: string;
  appSecret: string;
} {
  const appId = cfg.appId ?? process.env.FEISHU_APP_ID;
  const appSecret = cfg.appSecret ?? process.env.FEISHU_APP_SECRET;
  if (!appId || !appSecret) {
    throw new Error(
      "Feishu appId and appSecret are required. Set them in plugin config or FEISHU_APP_ID/FEISHU_APP_SECRET env vars.",
    );
  }
  return { appId, appSecret };
}

// ─── Message Content Extraction ───────────────────────────────────────────────

export function extractTextFromContent(messageType: string, content: string): string {
  try {
    const parsed = JSON.parse(content) as Record<string, unknown>;
    if (messageType === "text") {
      return (parsed.text as string | undefined) ?? content;
    }
    if (messageType === "post") {
      // Try zh_cn first, then en_us, then first available key
      const localeContent =
        (parsed.zh_cn as Record<string, unknown> | undefined) ??
        (parsed.en_us as Record<string, unknown> | undefined) ??
        (parsed[Object.keys(parsed)[0]] as Record<string, unknown> | undefined);
      if (!localeContent) return content;
      const paragraphs = localeContent.content as Array<Array<{ tag: string; text?: string }>>;
      if (!Array.isArray(paragraphs)) return content;
      return paragraphs
        .map((para) =>
          para
            .filter((node) => node.tag === "text" && node.text)
            .map((node) => node.text ?? "")
            .join(""),
        )
        .filter(Boolean)
        .join(" ")
        .trim();
    }
    if (messageType === "image") {
      return "[image]";
    }
    return `[unsupported: ${messageType}]`;
  } catch {
    return content;
  }
}

// ─── Mention Stripping ────────────────────────────────────────────────────────

export function stripBotMention(text: string): string {
  let result = text.replace(/@_user_\d+/g, "");
  if (config.botName) {
    const escaped = config.botName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    result = result.replace(new RegExp(`@?${escaped}`, "gi"), "");
  }
  return result.replace(/\s{2,}/g, " ").trim();
}

// ─── Session Key ──────────────────────────────────────────────────────────────

export function buildSessionKey(chatId: string, chatType: string): string {
  if (chatType === "p2p") return `feishu-dm-${chatId}`;
  return `feishu-group-${chatId}`;
}

// ─── Policy Check ─────────────────────────────────────────────────────────────

export function shouldRespond(
  chatType: string,
  mentions: Array<{ name?: string; id?: { open_id?: string } }>,
): boolean {
  if (chatType === "p2p") {
    return (config.dmPolicy ?? "open") === "open";
  }
  const policy = config.groupPolicy ?? "mention";
  if (policy === "disabled") return false;
  if (policy === "all") return true;
  // "mention" — check if bot is mentioned by name
  if (config.botName) {
    return mentions.some((m) => m.name?.toLowerCase() === config.botName?.toLowerCase());
  }
  return mentions.length > 0;
}

// ─── Send Response ────────────────────────────────────────────────────────────

const MAX_TEXT_LENGTH = 30000;

async function sendResponse(chatId: string, text: string): Promise<void> {
  if (!client) return;
  try {
    const useCards = config.useRichCards !== false;
    const chunks: string[] = [];
    let remaining = text;
    while (remaining.length > MAX_TEXT_LENGTH) {
      chunks.push(remaining.slice(0, MAX_TEXT_LENGTH));
      remaining = remaining.slice(MAX_TEXT_LENGTH);
    }
    chunks.push(remaining);

    for (const chunk of chunks) {
      if (useCards) {
        await client.im.message.create({
          params: { receive_id_type: "chat_id" },
          data: {
            receive_id: chatId,
            content: JSON.stringify({
              config: { wide_screen_mode: true },
              elements: [{ tag: "markdown", content: chunk }],
              header: {
                template: config.cardHeaderColor ?? "blue",
                title: {
                  content: agentIdentity.name ?? "WOPR",
                  tag: "plain_text",
                },
              },
            }),
            msg_type: "interactive",
          },
        });
      } else {
        await client.im.message.create({
          params: { receive_id_type: "chat_id" },
          data: {
            receive_id: chatId,
            content: JSON.stringify({ text: chunk }),
            msg_type: "text",
          },
        });
      }
    }
  } catch (err: unknown) {
    logger.error("Failed to send Feishu response", { chatId, err });
  }
}

// ─── Message Handler ──────────────────────────────────────────────────────────

async function handleMessageEvent(data: unknown): Promise<void> {
  if (!ctx || isShuttingDown) return;
  try {
    const event = data as {
      message: {
        chat_id: string;
        chat_type: string;
        message_type: string;
        content: string;
        mentions?: Array<{ name?: string; id?: { open_id?: string } }>;
      };
      sender: { sender_id: { open_id: string } };
    };

    const { chat_id, chat_type, message_type, content, mentions } = event.message;
    const senderOpenId = event.sender.sender_id.open_id;
    const mentionList = mentions ?? [];

    if (!shouldRespond(chat_type, mentionList)) return;

    let text = extractTextFromContent(message_type, content);

    if (chat_type === "group") {
      text = stripBotMention(text);
      if (!text) return;
    }

    const sessionKey = buildSessionKey(chat_id, chat_type);
    const channelInfo: ChannelInfo = { type: "feishu", id: chat_id };
    const from = senderOpenId;

    ctx.logMessage(sessionKey, text, { from, channel: channelInfo });

    const response = await ctx.inject(sessionKey, text, {
      from,
      channel: channelInfo,
    });

    await sendResponse(chat_id, response);
  } catch (err: unknown) {
    logger.error("Failed to handle Feishu message event", { err });
  }
}

// ─── Card Action Handler ──────────────────────────────────────────────────────

export async function handleCardAction(data: unknown): Promise<undefined> {
  try {
    const event = data as {
      action?: { tag?: string; value?: { key?: string; action?: string } };
    };
    const key = event?.action?.value?.key;
    const action = event?.action?.value?.action;

    if (!key || !action) {
      logger?.info("Card action received with no matching key", { data });
      return undefined;
    }

    const entry = pendingCallbacks.get(key);
    pendingCallbacks.delete(key);
    if (!entry) {
      logger?.info("Card action for expired/unknown request", { key });
      return undefined;
    }

    try {
      if (action === "accept" && entry.onAccept) {
        await entry.onAccept();
      } else if (action === "deny" && entry.onDeny) {
        await entry.onDeny();
      }
    } catch (err: unknown) {
      logger?.error("Card action callback failed", { key, action, err });
    }

    logger?.info("Card action processed", { key, action });
  } catch (err: unknown) {
    logger?.error("Failed to handle card action", { err });
  }
  return undefined;
}

// ─── WebSocket Mode ───────────────────────────────────────────────────────────

async function startWebSocket(): Promise<void> {
  const creds = resolveCredentials();
  const eventDispatcher = new lark.EventDispatcher({}).register({
    // biome-ignore lint/suspicious/noExplicitAny: SDK type
    "im.message.receive_v1": async (data: any) => {
      // Fire and forget — WebSocket mode has a 3-second timeout
      handleMessageEvent(data).catch((err) => {
        logger.error("Message handling failed:", { err });
      });
    },
    // biome-ignore lint/suspicious/noExplicitAny: SDK type
    "card.action.trigger": async (data: any) => {
      await handleCardAction(data);
    },
  });

  wsClient = new lark.WSClient({
    appId: creds.appId,
    appSecret: creds.appSecret,
    domain: resolveDomain(config),
    loggerLevel: lark.LoggerLevel.info,
  });

  wsClient.start({ eventDispatcher });
}

// ─── Webhook Mode ─────────────────────────────────────────────────────────────

async function startWebhook(): Promise<void> {
  const eventDispatcher = new lark.EventDispatcher({
    encryptKey: config.encryptKey ?? "",
    verificationToken: config.verificationToken,
  }).register({
    // biome-ignore lint/suspicious/noExplicitAny: SDK type
    "im.message.receive_v1": async (data: any) => {
      handleMessageEvent(data).catch((err) => {
        logger.error("Message handling failed:", { err });
      });
    },
  });

  const cardHandler = new lark.CardActionHandler(
    {
      encryptKey: config.encryptKey ?? "",
      verificationToken: config.verificationToken ?? "",
    },
    // biome-ignore lint/suspicious/noExplicitAny: SDK type
    handleCardAction as (data: any) => Promise<any>,
  );

  const eventPath = config.webhookPath ?? "/webhook/event";
  const cardPath = config.cardWebhookPath ?? "/webhook/card";
  const port = config.webhookPort ?? 3000;

  const eventAdapter = lark.adaptDefault(eventPath, eventDispatcher);
  const cardAdapter = lark.adaptDefault(cardPath, cardHandler);

  const server = http.createServer((req, res) => {
    const url = req.url ?? "";
    if (url.startsWith(eventPath)) {
      eventAdapter(req, res);
    } else if (url.startsWith(cardPath)) {
      cardAdapter(req, res);
    } else {
      res.writeHead(404);
      res.end("Not found");
    }
  });

  httpServer = server;
  server.listen(port, () => {
    logger.info(`Feishu webhook server listening on port ${port}`);
  });
}

// ─── Plugin Definition ────────────────────────────────────────────────────────

const plugin: WOPRPlugin = {
  name: "@wopr-network/wopr-plugin-feishu",
  version: "1.0.0",
  description: "Feishu/Lark channel plugin for WOPR using official Lark SDK",

  manifest: {
    name: "@wopr-network/wopr-plugin-feishu",
    version: "1.0.0",
    description: "Feishu/Lark channel plugin for WOPR using official Lark SDK",
    capabilities: ["channel"],
    requires: {
      env: ["FEISHU_APP_ID", "FEISHU_APP_SECRET"],
      network: {
        outbound: true,
        hosts: ["open.feishu.cn", "open.larksuite.com"],
      },
    },
    provides: {
      capabilities: [
        {
          type: "channel",
          id: "feishu",
          displayName: "Feishu/Lark",
        },
      ],
    },
    icon: "🪶",
    category: "communication",
    tags: ["feishu", "lark", "bytedance", "enterprise", "china", "bot"],
    lifecycle: {
      shutdownBehavior: "drain",
      shutdownTimeoutMs: 30_000,
    },
    configSchema,
  },

  async init(context: WOPRPluginContext) {
    ctx = context;
    isShuttingDown = false;
    config = context.getConfig<FeishuConfig>() ?? {};
    logger = initLogger();

    ctx.registerConfigSchema("wopr-plugin-feishu", configSchema);

    await refreshIdentity();

    // Register the channel provider immediately — even without credentials
    // so the platform knows this plugin provides the feishu channel type
    ctx.registerChannelProvider(feishuChannelProvider);

    // Validate credentials — skip bot startup if missing
    let creds: { appId: string; appSecret: string };
    try {
      creds = resolveCredentials(config);
    } catch (err: unknown) {
      logger.warn("Feishu plugin: missing credentials, bot will not start. Configure appId and appSecret.", { err });
      return;
    }

    try {
      client = new lark.Client({
        appId: creds.appId,
        appSecret: creds.appSecret,
        appType: lark.AppType.SelfBuild,
        domain: resolveDomain(config),
      });

      const mode = config.mode ?? "websocket";
      if (mode === "webhook") {
        await startWebhook();
      } else {
        await startWebSocket();
      }

      logger.info(`Feishu bot started in ${mode} mode`);

      cleanupInterval = setInterval(cleanupExpiredNotifications, 5 * 60 * 1000);
    } catch (err: unknown) {
      logger.error("Failed to start Feishu bot", { err });
    }
  },

  async shutdown() {
    isShuttingDown = true;

    if (cleanupInterval) {
      clearInterval(cleanupInterval);
      cleanupInterval = null;
    }
    pendingCallbacks.clear();

    if (ctx) {
      ctx.unregisterChannelProvider("feishu");
      ctx.unregisterConfigSchema("wopr-plugin-feishu");
    }

    if (wsClient) {
      try {
        wsClient.close();
      } catch {
        // Best-effort cleanup
      }
      wsClient = null;
    }

    if (httpServer) {
      httpServer.close();
      httpServer = null;
    }

    client = null;
    ctx = null;

    logger?.info("Feishu plugin stopped");
  },
};

export default plugin;
