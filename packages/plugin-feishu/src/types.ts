// ─── Plugin-local types ───────────────────────────────────────────────────────

export interface FeishuConfig {
  enabled?: boolean;
  mode?: "websocket" | "webhook";
  appId?: string;
  appSecret?: string;
  encryptKey?: string;
  verificationToken?: string;
  domain?: "feishu" | "lark" | string;
  botName?: string;
  webhookPort?: number;
  webhookPath?: string;
  cardWebhookPath?: string;
  dmPolicy?: "open" | "disabled";
  groupPolicy?: "mention" | "all" | "disabled";
  useRichCards?: boolean;
  cardHeaderColor?: string;
}
