import { logger } from "./logger.js";

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

type ValidatorFn = (key: string) => Promise<ValidationResult>;

const validators: Record<string, ValidatorFn> = {
  anthropic: async (key) => {
    try {
      const res = await fetch("https://api.anthropic.com/v1/models", {
        headers: { "x-api-key": key, "anthropic-version": "2023-06-01" },
      });
      if (res.ok) return { valid: true };
      const body = await res.text();
      return { valid: false, error: `Anthropic API returned ${res.status}: ${body}` };
    } catch (err) {
      return { valid: false, error: `Network error: ${String(err)}` };
    }
  },

  openai: async (key) => {
    try {
      const res = await fetch("https://api.openai.com/v1/models", {
        headers: { Authorization: `Bearer ${key}` },
      });
      if (res.ok) return { valid: true };
      const body = await res.text();
      return { valid: false, error: `OpenAI API returned ${res.status}: ${body}` };
    } catch (err) {
      return { valid: false, error: `Network error: ${String(err)}` };
    }
  },

  discord: async (key) => {
    try {
      const res = await fetch("https://discord.com/api/v10/users/@me", {
        headers: { Authorization: `Bot ${key}` },
      });
      if (res.ok) return { valid: true };
      const body = await res.text();
      return { valid: false, error: `Discord API returned ${res.status}: ${body}` };
    } catch (err) {
      return { valid: false, error: `Network error: ${String(err)}` };
    }
  },

  telegram: async (key) => {
    try {
      const res = await fetch(`https://api.telegram.org/bot${key}/getMe`);
      if (res.ok) return { valid: true };
      const body = await res.text();
      return { valid: false, error: `Telegram API returned ${res.status}: ${body}` };
    } catch (err) {
      return { valid: false, error: `Network error: ${String(err)}` };
    }
  },
};

export async function validateKey(provider: string, key: string): Promise<ValidationResult> {
  const fn = validators[provider];
  if (!fn) {
    return { valid: false, error: `Unknown provider: ${provider}. Supported: ${Object.keys(validators).join(", ")}` };
  }
  logger.debug({ msg: "Validating API key", provider });
  return fn(key);
}
