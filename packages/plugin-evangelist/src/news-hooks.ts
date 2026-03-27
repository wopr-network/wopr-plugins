import type { NewsHook, ProductInfo } from "./types.js";

const patterns: Array<{ keywords: string[]; angleTemplate: (product: ProductInfo) => string }> = [
  {
    keywords: ["price", "pricing", "cost", "cheaper", "cuts", "discount"],
    angleTemplate: (p) =>
      `pricing news — position "${p.oneLiner}" as cost-effective. We route to the cheapest provider automatically.`,
  },
  {
    keywords: ["model", "release", "launch", "introduces", "announces", "new"],
    angleTemplate: (p) =>
      `New model announcement — highlight that "${p.oneLiner}" already supports new models or will automatically.`,
  },
  {
    keywords: ["acquisition", "acquires", "bought", "merger"],
    angleTemplate: (p) => `Acquisition news — position "${p.oneLiner}" as a neutral, independent alternative.`,
  },
  {
    keywords: ["outage", "down", "incident", "failure"],
    angleTemplate: (p) => `Reliability incident — position "${p.oneLiner}" as resilient with provider fallback.`,
  },
];

export function mapHeadlineToAngle(headline: string, product: ProductInfo): string {
  const lower = headline.toLowerCase();
  for (const pattern of patterns) {
    if (pattern.keywords.some((kw) => lower.includes(kw))) {
      return pattern.angleTemplate(product);
    }
  }
  return `Industry news: "${headline}" — find a relevant angle for "${product.oneLiner}" that adds genuine value to the conversation.`;
}

export function createNewsHook(headline: string, source: string, product: ProductInfo): NewsHook {
  return {
    headline,
    source,
    detectedAt: new Date().toISOString(),
    angle: mapHeadlineToAngle(headline, product),
    drafted: false,
  };
}
