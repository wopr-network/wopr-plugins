export type {
  AgentIdentity,
  ConfigField,
  ConfigSchema,
  ContextPart,
  ContextProvider,
  MessageInfo,
  PluginCommand,
  WOPRPlugin,
  WOPRPluginContext,
} from "@wopr-network/plugin-types";

/** Product knowledge base — provided during setup. */
export interface ProductInfo {
  oneLiner: string;
  audience: "developers" | "founders" | "both";
  voice: "punchy" | "casual" | "technical";
  details?: string;
}

/** Social account binding. */
export interface SocialAccount {
  platform: "twitter" | "reddit" | "discord";
  handle: string;
}

/** Evangelist plugin config — persisted via ctx.saveConfig(). */
export interface EvangelistConfig {
  product: ProductInfo;
  accounts: SocialAccount[];
  calendarEnabled: boolean;
  newsHooksEnabled: boolean;
}

/** A scheduled content item in the calendar. */
export interface ScheduledPost {
  id: string;
  platform: "twitter" | "reddit" | "discord";
  content: string;
  scheduledAt: string; // ISO 8601
  status: "pending" | "posted" | "failed";
  createdAt: string;
}

/** A news event mapped to a content opportunity. */
export interface NewsHook {
  headline: string;
  source: string;
  detectedAt: string;
  angle: string; // how this maps to a content opportunity
  drafted: boolean;
}
