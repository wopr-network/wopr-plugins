import type { ContextPart, ContextProvider, MessageInfo, ProductInfo } from "./types.js";

export function createBrandVoiceProvider(product: ProductInfo): ContextProvider {
  return {
    name: "evangelist-brand-voice",
    priority: 50,
    async getContext(_session: string, _message: MessageInfo): Promise<ContextPart | null> {
      if (!product.oneLiner) return null;

      const voiceDirections: Record<string, string> = {
        punchy: "Be direct, concise, and sharp. Short sentences. No fluff. Every word earns its place.",
        casual: "Be friendly, approachable, and conversational. Like talking to a smart friend over coffee.",
        technical: "Be precise, detailed, and authoritative. Use correct terminology. Cite specifics.",
      };

      const audienceDirections: Record<string, string> = {
        developers:
          "Your audience is developers. They respect technical accuracy, hate marketing speak, and value honesty.",
        founders:
          "Your audience is founders and startup operators. They care about ROI, speed, and competitive advantage.",
        both: "Your audience is developers and founders. Balance technical credibility with business value.",
      };

      const content = [
        `You are the voice of this product: "${product.oneLiner}"`,
        "",
        `Voice style (${product.voice}): ${voiceDirections[product.voice] || voiceDirections.punchy}`,
        "",
        `Audience (${product.audience}): ${audienceDirections[product.audience] || audienceDirections.both}`,
        "",
        "Rules:",
        "- Never sound like a generic AI. Sound like the brand.",
        "- Be genuinely helpful, not spammy.",
        "- If you don't know something, say so. Credibility > volume.",
        product.details ? `\nAdditional product context: ${product.details}` : "",
      ]
        .filter(Boolean)
        .join("\n");

      return {
        content,
        role: "system",
        metadata: { source: "evangelist-brand-voice", priority: 50 },
      };
    },
  };
}
