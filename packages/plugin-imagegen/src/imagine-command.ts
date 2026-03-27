import { isValidSize, parseImaginePrompt } from "./prompt-parser.js";
import type { ChannelCommandContext, ImageGenConfig, ImagineResponse, WOPRPluginContext } from "./types.js";

/**
 * Handle the /imagine command from any channel.
 *
 * Flow:
 * 1. Parse prompt text + flags
 * 2. Apply config defaults for missing flags
 * 3. Call ctx.inject with a capability request message
 * 4. Core routes via socket layer (credit check, adapter selection)
 * 5. Reply with image URL or error message
 */
export async function handleImagineCommand(
  cmdCtx: ChannelCommandContext,
  pluginCtx: WOPRPluginContext,
  config: ImageGenConfig,
): Promise<void> {
  const rawPrompt = cmdCtx.args.join(" ").trim();

  if (!rawPrompt) {
    await cmdCtx.reply(
      "Please provide a prompt. Usage: /imagine <prompt> [--model flux] [--size 1024x1024] [--style photorealistic]",
    );
    return;
  }

  const request = parseImaginePrompt(rawPrompt);

  if (!request.prompt) {
    await cmdCtx.reply(
      "Could not extract a prompt from your message. Please provide a description of the image you want.",
    );
    return;
  }

  const maxLen = config.maxPromptLength ?? 1000;
  if (request.prompt.length > maxLen) {
    await cmdCtx.reply(`Prompt is too long (${request.prompt.length} chars). Maximum is ${maxLen} characters.`);
    return;
  }

  // Validate size format if provided
  if (request.size && !isValidSize(request.size)) {
    await cmdCtx.reply(`Invalid size format: "${request.size}". Use WxH format, e.g. 1024x1024`);
    return;
  }

  // Apply config defaults
  const model = request.model ?? config.defaultModel ?? "flux";
  const size = request.size ?? config.defaultSize ?? "1024x1024";
  const style = request.style ?? config.defaultStyle ?? "auto";

  // Build the capability request message that core understands.
  const capabilityMessage = [
    `[capability:image-generation]`,
    `prompt: ${request.prompt}`,
    `model: ${model}`,
    `size: ${size}`,
    `style: ${style}`,
  ].join("\n");

  // Build a session key. Use the channel as session context.
  const sessionKey = `imagegen:${cmdCtx.channelType}:${cmdCtx.channel}`;

  try {
    const response = await pluginCtx.inject(sessionKey, capabilityMessage, {
      from: cmdCtx.sender,
      channel: { type: cmdCtx.channelType, id: cmdCtx.channel, name: "imagine" },
    });

    const parsed = parseImagineResponse(response);

    if (parsed.error) {
      if (parsed.error === "insufficient_credits") {
        await cmdCtx.reply("You need credits to generate images. Visit your WOPR dashboard to add credits.");
      } else {
        await cmdCtx.reply(`Image generation failed: ${parsed.error}`);
      }
      return;
    }

    if (parsed.imageUrl) {
      await cmdCtx.reply(parsed.imageUrl);
    } else {
      await cmdCtx.reply(response || "Image generation completed but no image was returned.");
    }
  } catch (error: unknown) {
    pluginCtx.log.error("Image generation failed", error);
    await cmdCtx.reply("Something went wrong generating your image. Please try again.");
  }
}

/**
 * Parse the response string from ctx.inject.
 * Handles JSON with imageUrl/error, plain URL, or text fallback.
 */
export function parseImagineResponse(response: string): ImagineResponse {
  // Try JSON first
  try {
    const parsed = JSON.parse(response) as Record<string, unknown>;
    if (typeof parsed.imageUrl === "string") return { imageUrl: parsed.imageUrl };
    if (typeof parsed.error === "string") return { error: parsed.error };
    if (typeof parsed.url === "string") return { imageUrl: parsed.url };
  } catch {
    // Not JSON
  }

  // Check if the response contains a URL
  const urlMatch = response.match(/https?:\/\/\S+\.(png|jpg|jpeg|gif|webp)(\?\S+)?/i);
  if (urlMatch) {
    return { imageUrl: urlMatch[0] };
  }

  // Check for known error strings
  if (
    response.toLowerCase().includes("insufficient_credits") ||
    response.toLowerCase().includes("insufficient credits")
  ) {
    return { error: "insufficient_credits" };
  }

  return {};
}
