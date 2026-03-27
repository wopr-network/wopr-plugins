import type { ImagineRequest } from "./types.js";

const KNOWN_FLAGS = new Set(["model", "size", "style"]);

export function parseImaginePrompt(raw: string): ImagineRequest {
  const flags: Record<string, string> = {};

  const cleaned = raw.replace(/--([\w]+)\s+(\S+)/g, (match, key: string, value: string) => {
    if (KNOWN_FLAGS.has(key) && !value.startsWith("--")) {
      flags[key] = value;
      return "";
    }
    return match;
  });

  const prompt = cleaned.replace(/\s+/g, " ").trim();

  return {
    prompt,
    model: flags.model,
    size: flags.size,
    style: flags.style,
  };
}

/** Validate size string is in WxH format, e.g. "1024x1024" (min 2 digits each side) */
export function isValidSize(size: string): boolean {
  return /^\d{2,4}x\d{2,4}$/.test(size);
}
