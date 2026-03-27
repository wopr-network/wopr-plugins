export type ExtractionMode = "full-exchange" | "heuristic";

export interface ExtractedMemory {
  content: string;
  summary: string;
  tags: string[];
}

// Patterns that signal the user is sharing something worth remembering
const MEMORY_TRIGGERS: RegExp[] = [
  /\bremember\b/i,
  /\bdon'?t forget\b/i,
  /\bimportant[:\s]/i,
  /\bnote[:\s]/i,
  /\bkey insight[:\s]/i,
  /\bmy name is\b/i,
  /\bi('m| am) \w/i,
  /\bi prefer\b/i,
  /\bi like\b/i,
  /\bi(?: always| usually| typically| often)\b/i,
  /\balways\s+(?:use|do|prefer|call)\b/i,
  /\bnever\s+(?:use|do|add)\b/i,
  /\bmy\s+(?:email|phone|address|birthday|team|boss|company|project)\b/i,
  /\bdecided to\b/i,
  /\bgoing forward\b/i,
  /\bfrom now on\b/i,
];

/**
 * Heuristic extraction — only stores exchanges with explicit memory triggers
 * or that exceed the minimum length threshold.
 *
 * Returns null when the exchange isn't worth storing.
 */
export function extractHeuristic(userMsg: string, assistantMsg: string, minLength = 300): ExtractedMemory | null {
  const hasTrigger = MEMORY_TRIGGERS.some((re) => re.test(userMsg));
  const isLongEnough = userMsg.length + assistantMsg.length >= minLength;

  if (!hasTrigger && !isLongEnough) return null;

  const content = [`**User:** ${userMsg.slice(0, 1200)}`, "", `**Assistant:** ${assistantMsg.slice(0, 1200)}`].join(
    "\n",
  );

  const summary = userMsg.slice(0, 200);
  const tags: string[] = ["auto"];
  if (hasTrigger) tags.push("triggered");
  if (isLongEnough && !hasTrigger) tags.push("long-exchange");

  return { content, summary, tags };
}

/**
 * Full-exchange extraction — always stores the Q&A verbatim (truncated).
 */
export function extractFullExchange(userMsg: string, assistantMsg: string): ExtractedMemory {
  const content = [`**User:** ${userMsg.slice(0, 2000)}`, "", `**Assistant:** ${assistantMsg.slice(0, 2000)}`].join(
    "\n",
  );

  return {
    content,
    summary: userMsg.slice(0, 200),
    tags: ["exchange"],
  };
}
