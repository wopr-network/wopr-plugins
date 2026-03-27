import type { ProductInfo } from "./types.js";

const guidelines: Record<string, string> = {
  twitter:
    "Twitter/X: Max 280 characters per tweet. Threads for longer content. Punchy, quotable. Use hooks in the first tweet. No hashtag spam — 1-2 max.",
  reddit:
    "Reddit: Prioritize depth and genuine value. Redditors detect marketing instantly. Be helpful first. Long-form is fine. Engage in comments. Match the subreddit tone.",
  discord:
    "Discord: Keep it casual and conversational. Short messages. Use emoji sparingly. Be a community member, not a broadcaster. Jump into existing conversations naturally.",
};

export function platformGuidelines(platform: string): string {
  return guidelines[platform] || `${platform}: Write content appropriate for the platform's culture and norms.`;
}

export function buildContentPrompt(product: ProductInfo, platform: string, topic: string): string {
  return [
    `You are drafting content for: "${product.oneLiner}"`,
    `Platform: ${platform}`,
    `Topic: ${topic}`,
    "",
    "Platform guidelines:",
    platformGuidelines(platform),
    "",
    `Voice: ${product.voice}. Audience: ${product.audience}.`,
    "",
    "Draft the content now. Output ONLY the post text, nothing else.",
  ].join("\n");
}
