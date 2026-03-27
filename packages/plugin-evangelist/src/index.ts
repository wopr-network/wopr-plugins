import { createBrandVoiceProvider } from "./brand-voice.js";
import { logger } from "./logger.js";
import { ContentScheduler } from "./scheduler.js";
import type { ConfigSchema, ProductInfo, WOPRPlugin, WOPRPluginContext } from "./types.js";

let ctx: WOPRPluginContext | null = null;
let scheduler: ContentScheduler | null = null;

const configSchema: ConfigSchema = {
  title: "Market Your Product",
  description: "Configure the Evangelist superpower — your product markets itself",
  fields: [
    {
      name: "productOneLiner",
      type: "text",
      label: "Product One-Liner",
      placeholder: "AI bots that work for you",
      required: true,
      description: "Your product in one sentence",
    },
    {
      name: "audience",
      type: "select",
      label: "Target Audience",
      required: true,
      options: [
        { value: "developers", label: "Developers" },
        { value: "founders", label: "Founders" },
        { value: "both", label: "Both" },
      ],
      default: "both",
      description: "Who are you marketing to?",
    },
    {
      name: "voice",
      type: "select",
      label: "Brand Voice",
      required: true,
      options: [
        { value: "punchy", label: "Punchy & Direct" },
        { value: "casual", label: "Friendly & Casual" },
        { value: "technical", label: "Technical & Precise" },
      ],
      default: "punchy",
      description: "How should the bot sound?",
    },
    {
      name: "productDetails",
      type: "textarea",
      label: "Additional Product Details",
      placeholder: "Key features, differentiators, pricing...",
      description: "Extra context for the bot to draw from",
    },
    {
      name: "calendarEnabled",
      type: "boolean",
      label: "Content Calendar",
      default: true,
      description: "Enable scheduled posts and content calendar",
    },
    {
      name: "newsHooksEnabled",
      type: "boolean",
      label: "News Hooks",
      default: true,
      description: "Monitor AI news and map events to content opportunities",
    },
  ],
};

const plugin: WOPRPlugin = {
  name: "wopr-plugin-evangelist",
  version: "0.1.0",
  description: "Market Your Product superpower — your product markets itself while you sleep",
  manifest: {
    name: "wopr-plugin-evangelist",
    version: "0.1.0",
    description: "Market Your Product superpower — your product markets itself while you sleep",
    capabilities: ["superpower", "content-generation", "marketing"],
    category: "superpower",
    tags: ["marketing", "content", "social", "evangelist", "superpower"],
    icon: "📣",
    requires: {
      capabilities: [
        { capability: "channel:twitter" },
        { capability: "channel:reddit" },
        { capability: "channel:discord", optional: true },
      ],
    },
    provides: {
      capabilities: [{ type: "superpower", id: "evangelist", displayName: "Market Your Product" }],
    },
    lifecycle: { shutdownBehavior: "graceful" },
    configSchema,
  },

  async init(context: WOPRPluginContext) {
    ctx = context;
    ctx.registerConfigSchema("wopr-plugin-evangelist", configSchema);

    // Conversational setup (WOP-1017 pattern)
    ctx.registerSetupContextProvider(({ partialConfig }) => {
      const hasProduct = !!partialConfig.productOneLiner;
      const hasAudience = !!partialConfig.audience;
      const hasVoice = !!partialConfig.voice;

      let instructions = "You are helping the user set up the Evangelist superpower for WOPR.\n\n";

      if (!hasProduct) {
        instructions += '### Step 1: Product\nAsk: "What\'s your product? Give me the one-liner."\n\n';
      } else {
        instructions += "### Step 1: Product\nProduct one-liner is set. Moving on.\n\n";
      }

      if (!hasAudience) {
        instructions += '### Step 2: Audience\nAsk: "Who\'s the audience? Developers? Founders? Both?"\n\n';
      } else {
        instructions += "### Step 2: Audience\nAudience is set. Moving on.\n\n";
      }

      if (!hasVoice) {
        instructions +=
          '### Step 3: Voice\nAsk: "What\'s the voice? Punchy and direct? Friendly and casual? Technical?"\n\n';
      } else {
        instructions += "### Step 3: Voice\nVoice is set. Moving on.\n\n";
      }

      instructions += '### Step 4: Social Accounts\nAsk: "Drop me your social accounts — I\'ll take it from here."\n';

      return instructions;
    });

    // Read config and register brand voice
    const config = ctx.getConfig<{
      productOneLiner?: string;
      audience?: string;
      voice?: string;
      productDetails?: string;
      calendarEnabled?: boolean;
      newsHooksEnabled?: boolean;
    }>();

    if (config?.productOneLiner) {
      const product: ProductInfo = {
        oneLiner: config.productOneLiner,
        audience: (config.audience as ProductInfo["audience"]) || "both",
        voice: (config.voice as ProductInfo["voice"]) || "punchy",
        details: config.productDetails,
      };

      const brandVoice = createBrandVoiceProvider(product);
      ctx.registerContextProvider(brandVoice);
      logger.info({ msg: "Brand voice registered", product: product.oneLiner });
    } else {
      logger.warn("No product configured — brand voice not registered. Run setup.");
    }

    // Initialize scheduler
    scheduler = new ContentScheduler();
    logger.info("Evangelist superpower initialized");
  },

  async shutdown() {
    if (ctx?.unregisterContextProvider) {
      ctx.unregisterContextProvider("evangelist-brand-voice");
    }
    if (ctx?.unregisterSetupContextProvider) {
      ctx.unregisterSetupContextProvider();
    }
    if (ctx?.unregisterConfigSchema) {
      ctx.unregisterConfigSchema("wopr-plugin-evangelist");
    }
    scheduler = null;
    ctx = null;
    logger.info("Evangelist superpower shut down");
  },
};

export default plugin;

/** Returns the active scheduler instance (null if plugin is not initialized). */
export function getScheduler(): ContentScheduler | null {
  return scheduler;
}
