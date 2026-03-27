import { imagegenConfigSchema } from "./config-schema.js";
import { handleImagineCommand, parseImagineResponse } from "./imagine-command.js";
import { isValidSize } from "./prompt-parser.js";
import type {
  A2AToolResult,
  ChannelCommand,
  ChannelProvider,
  ImageGenConfig,
  PluginManifest,
  WOPRPlugin,
  WOPRPluginContext,
} from "./types.js";

let ctx: WOPRPluginContext | null = null;
const registeredProviderIds: string[] = [];
const cleanups: (() => void)[] = [];

const manifest: PluginManifest = {
  name: "@wopr-network/wopr-plugin-imagegen",
  version: "1.0.0",
  description: "Generate images with AI — /imagine in any channel",
  author: "WOPR",
  license: "MIT",
  capabilities: ["image-generation"],
  requires: {
    network: {
      outbound: true,
    },
  },
  provides: {
    capabilities: [
      {
        type: "image-gen",
        id: "wopr-imagegen-dalle",
        displayName: "Image Generation (DALL-E)",
        tier: "byok",
      },
    ],
  },
  icon: "palette",
  category: "creative",
  tags: ["imagegen", "image-generation", "ai", "creative", "imagine"],
  lifecycle: {
    shutdownBehavior: "drain",
    shutdownTimeoutMs: 30_000,
  },
  configSchema: imagegenConfigSchema,
};

function getConfig(): ImageGenConfig {
  return ctx?.getConfig<ImageGenConfig>() ?? {};
}

function buildImagineCommand(): ChannelCommand {
  return {
    name: "imagine",
    description: "Generate an image from a text prompt",
    async handler(cmdCtx) {
      if (!ctx) return;
      await handleImagineCommand(cmdCtx, ctx, getConfig());
    },
  };
}

const plugin: WOPRPlugin = {
  name: "@wopr-network/wopr-plugin-imagegen",
  version: "1.0.0",
  description: "Generate images with AI — /imagine in any channel",
  manifest,

  async init(context: WOPRPluginContext) {
    ctx = context;

    // 1. Register config schema
    ctx.registerConfigSchema("wopr-plugin-imagegen", imagegenConfigSchema);
    cleanups.push(() => ctx?.unregisterConfigSchema?.("wopr-plugin-imagegen"));

    // 2. Register A2A tools
    if (ctx.registerA2AServer) {
      cleanups.push(() =>
        (ctx as unknown as { unregisterA2AServer?: (name: string) => void })?.unregisterA2AServer?.("imagegen"),
      );
      ctx.registerA2AServer({
        name: "imagegen",
        version: "1.0",
        tools: [
          {
            name: "imagine",
            description:
              "Generate an image from a text prompt. Returns an image URL. " +
              "Supports optional model, size, and style parameters.",
            inputSchema: {
              type: "object",
              properties: {
                prompt: {
                  type: "string",
                  description: "Text description of the image to generate",
                },
                model: {
                  type: "string",
                  description: "Model to use (flux, sdxl, dall-e). Defaults to plugin config.",
                },
                size: {
                  type: "string",
                  description: "Image dimensions in WxH format (e.g. 1024x1024). Defaults to plugin config.",
                },
                style: {
                  type: "string",
                  description:
                    "Style preset (auto, photorealistic, artistic, anime, pixel-art). Defaults to plugin config.",
                },
                sessionId: {
                  type: "string",
                  description: "Session ID for context (optional).",
                },
              },
              required: ["prompt"],
            },
            async handler(args: Record<string, unknown>): Promise<A2AToolResult> {
              if (!ctx) {
                return {
                  content: [{ type: "text", text: "Plugin not initialized" }],
                  isError: true,
                };
              }

              const prompt = args.prompt;
              if (typeof prompt !== "string" || !prompt) {
                return {
                  content: [{ type: "text", text: "prompt is required and must be a non-empty string" }],
                  isError: true,
                };
              }
              const config = getConfig();

              const maxLen = config.maxPromptLength ?? 1000;
              if (prompt.length > maxLen) {
                return {
                  content: [
                    {
                      type: "text",
                      text: `Prompt is too long (${prompt.length} chars). Maximum is ${maxLen} characters.`,
                    },
                  ],
                  isError: true,
                };
              }

              const modelArg = typeof args.model === "string" ? args.model : undefined;
              const sizeArg = typeof args.size === "string" ? args.size : undefined;
              const styleArg = typeof args.style === "string" ? args.style : undefined;
              const sessionIdArg = typeof args.sessionId === "string" ? args.sessionId : undefined;

              if (sizeArg !== undefined && !isValidSize(sizeArg)) {
                return {
                  content: [
                    { type: "text", text: `Invalid size format: "${sizeArg}". Use WxH format, e.g. 1024x1024` },
                  ],
                  isError: true,
                };
              }

              const model = modelArg ?? config.defaultModel ?? "flux";
              const size = sizeArg ?? config.defaultSize ?? "1024x1024";
              const style = styleArg ?? config.defaultStyle ?? "auto";
              const sessionId = sessionIdArg ?? "imagegen:a2a";

              const capabilityMessage = [
                `[capability:image-generation]`,
                `prompt: ${prompt}`,
                `model: ${model}`,
                `size: ${size}`,
                `style: ${style}`,
              ].join("\n");

              try {
                const response = await ctx.inject(sessionId, capabilityMessage, {
                  from: "a2a:imagegen",
                });

                const parsed = parseImagineResponse(response);
                if (parsed.error) {
                  return {
                    content: [{ type: "text", text: `Error: ${parsed.error}` }],
                    isError: true,
                  };
                }
                if (parsed.imageUrl) {
                  return {
                    content: [
                      { url: parsed.imageUrl, mediaType: "image/png" } as unknown as {
                        type: "image";
                        data?: string;
                        mimeType?: string;
                      },
                      { type: "text", text: `Generated image: ${parsed.imageUrl}` },
                    ],
                  };
                }

                return { content: [{ type: "text", text: response }] };
              } catch (error: unknown) {
                return {
                  content: [{ type: "text", text: `Image generation failed: ${error}` }],
                  isError: true,
                };
              }
            },
          },
        ],
      });
      ctx.log.info("Registered imagegen A2A tools");
    }

    // 3. Register /imagine command on all available channel providers
    const imagineCmd = buildImagineCommand();
    const providers = ctx.getChannelProviders?.() ?? [];
    for (const provider of providers) {
      const p = provider as ChannelProvider;
      if ("registerCommand" in p && typeof p.registerCommand === "function") {
        p.registerCommand(imagineCmd);
        registeredProviderIds.push(p.id);
        ctx.log.info(`Registered /imagine on channel provider: ${p.id}`);
      }
    }

    // 4. Listen for new channel providers (late-loading plugins)
    if (ctx.events) {
      const unsub = ctx.events.on("plugin:afterInit", () => {
        if (!ctx) return;
        const currentProviders = ctx.getChannelProviders?.() ?? [];
        for (const provider of currentProviders) {
          const p = provider as ChannelProvider;
          if ("registerCommand" in p && typeof p.registerCommand === "function") {
            const providerId = p.id;
            if (!registeredProviderIds.includes(providerId)) {
              p.registerCommand(buildImagineCommand());
              registeredProviderIds.push(providerId);
              ctx.log.info(`Late-registered /imagine on channel provider: ${providerId}`);
            }
          }
        }
      });
      cleanups.push(unsub);
    }

    ctx.log.info("ImageGen plugin initialized");
  },

  async shutdown() {
    for (const cleanup of cleanups) {
      try {
        cleanup();
      } catch (_error: unknown) {
        // Cleanup may fail if provider is already gone
      }
    }
    cleanups.length = 0;

    if (ctx) {
      const providers = ctx.getChannelProviders?.() ?? [];
      for (const provider of providers) {
        try {
          const p = provider as ChannelProvider;
          if ("unregisterCommand" in p && typeof p.unregisterCommand === "function") {
            p.unregisterCommand("imagine");
          }
        } catch (_error: unknown) {
          // Provider may already be gone
        }
      }
    }
    registeredProviderIds.length = 0;
    ctx = null;
  },
};

export default plugin;
