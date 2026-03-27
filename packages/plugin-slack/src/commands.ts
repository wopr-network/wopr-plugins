/**
 * Slack Slash Commands for WOPR
 *
 * Registers /status, /new, /model, /session, /think, /verbose,
 * /usage, /cancel, /help, /compact via Bolt's app.command() API.
 * All responses are ephemeral (visible only to the invoking user).
 */

import type { App } from "@slack/bolt";
import { isUserAllowed } from "./pairing.js";
import type { ProviderInfo, StreamMessage, WOPRPluginContext } from "./types.js";

// ---------------------------------------------------------------------------
// Session state (mirrors Discord plugin's per-session config)
// ---------------------------------------------------------------------------

interface SessionState {
  thinkingLevel: string;
  verbose: boolean;
  usageMode: string;
  messageCount: number;
  model: string;
}

const sessionStates = new Map<string, SessionState>();

// Per-user session key overrides set by /session command
const sessionOverrides = new Map<string, string>();

export function getSessionState(sessionKey: string): SessionState {
  let state = sessionStates.get(sessionKey);
  if (!state) {
    state = {
      thinkingLevel: "medium",
      verbose: false,
      usageMode: "tokens",
      messageCount: 0,
      model: "claude-sonnet-4-20250514",
    };
    sessionStates.set(sessionKey, state);
  }
  return state;
}

export function resetSession(sessionKey: string): void {
  sessionStates.delete(sessionKey);
}

export function incrementMessageCount(sessionKey: string): void {
  getSessionState(sessionKey).messageCount++;
}

// ---------------------------------------------------------------------------
// Model resolution helpers (same logic as Discord plugin)
// ---------------------------------------------------------------------------

interface ResolvedModel {
  provider: string;
  id: string;
  name: string;
}

function modelIdToDisplayName(id: string): string {
  const claude = id.match(/^claude-(\w+)-(\d[\d.-]*)(?:-\d{8})?$/);
  if (claude) {
    const tier = claude[1].charAt(0).toUpperCase() + claude[1].slice(1);
    const ver = claude[2].replace(/-/g, ".");
    return `${tier} ${ver}`;
  }
  const gpt = id.match(/^gpt-(.+)$/i);
  if (gpt) return `GPT ${gpt[1]}`;
  const o = id.match(/^o(\d.*)$/);
  if (o) return `o${o[1]}`;
  return id;
}

function getAllModels(ctx: WOPRPluginContext): ResolvedModel[] {
  const results: ResolvedModel[] = [];
  const providerIds = ["anthropic", "openai", "kimi", "opencode", "codex"];
  for (const pid of providerIds) {
    const provider = ctx.getProvider?.(pid) as ProviderInfo | undefined;
    if (!provider?.supportedModels) continue;
    for (const modelId of provider.supportedModels) {
      results.push({
        provider: pid,
        id: modelId,
        name: modelIdToDisplayName(modelId),
      });
    }
  }
  return results;
}

function resolveModel(ctx: WOPRPluginContext, input: string): ResolvedModel | null {
  const models = getAllModels(ctx);
  if (models.length === 0) return null;

  const q = input.toLowerCase().trim();

  const exact = models.find((m) => m.id === q);
  if (exact) return exact;

  const partial = models.find((m) => m.id.includes(q));
  if (partial) return partial;

  const byName = models.find((m) => m.name.toLowerCase().includes(q));
  if (byName) return byName;

  return null;
}

// ---------------------------------------------------------------------------
// Build a session key from Slack command payload
// ---------------------------------------------------------------------------

function baseSessionKey(channelId: string, userId: string): string {
  if (channelId.startsWith("D")) {
    return `slack-dm-${userId}`;
  }
  return `slack-channel-${channelId}`;
}

function sessionKeyFromCommand(channelId: string, userId: string): string {
  const base = baseSessionKey(channelId, userId);
  return sessionOverrides.get(base) ?? base;
}

/**
 * Resolve effective session key, respecting /session overrides.
 * Used by the message handler in index.ts.
 */
export function getEffectiveSessionKey(channelId: string, userId: string, isDM: boolean): string {
  const base = isDM ? `slack-dm-${userId}` : `slack-channel-${channelId}`;
  return sessionOverrides.get(base) ?? base;
}

// ---------------------------------------------------------------------------
// Register all slash commands on the Bolt app
// ---------------------------------------------------------------------------

export function registerSlashCommands(boltApp: App, getCtx: () => WOPRPluginContext | null): void {
  /** Require ctx + authorized user. Returns ctx on success, null on deny. */
  async function requireAuth(
    command: { user_id: string },
    respond: (msg: { response_type: "ephemeral" | "in_channel"; text: string }) => Promise<unknown>,
  ): Promise<WOPRPluginContext | null> {
    const ctx = getCtx();
    if (!ctx) {
      await respond({
        response_type: "ephemeral",
        text: "WOPR is not ready yet.",
      });
      return null;
    }
    if (!isUserAllowed(ctx, command.user_id)) {
      await respond({
        response_type: "ephemeral",
        text: "You are not authorized to use WOPR commands. Please pair your account first via DM.",
      });
      return null;
    }
    return ctx;
  }

  // /status — show session status
  boltApp.command("/status", async ({ command, ack, respond }) => {
    await ack();
    const ctx = await requireAuth(command, respond);
    if (!ctx) return;
    const sessionKey = sessionKeyFromCommand(command.channel_id, command.user_id);
    const state = getSessionState(sessionKey);
    await respond({
      response_type: "ephemeral",
      text:
        `*Session Status*\n\n` +
        `*Session:* ${sessionKey}\n` +
        `*Model:* ${modelIdToDisplayName(state.model)}\n` +
        `*Thinking Level:* ${state.thinkingLevel}\n` +
        `*Verbose Mode:* ${state.verbose ? "On" : "Off"}\n` +
        `*Usage Tracking:* ${state.usageMode}\n` +
        `*Messages:* ${state.messageCount}`,
    });
  });

  // /new — reset session
  boltApp.command("/new", async ({ command, ack, respond }) => {
    await ack();
    if (!(await requireAuth(command, respond))) return;
    const sessionKey = sessionKeyFromCommand(command.channel_id, command.user_id);
    resetSession(sessionKey);
    await respond({
      response_type: "ephemeral",
      text: "*Session Reset*\n\nLocal session state (thinking level, model preference) has been cleared. Note: WOPR core conversation context is not affected.",
    });
  });

  // /compact — compact session context
  boltApp.command("/compact", async ({ command, ack, respond }) => {
    await ack();
    const ctx = await requireAuth(command, respond);
    if (!ctx) return;
    const sessionKey = sessionKeyFromCommand(command.channel_id, command.user_id);

    await respond({
      response_type: "ephemeral",
      text: "*Compacting Session...*\n\nTriggering context compaction.",
    });

    try {
      let compactMetadata: { pre_tokens?: number; trigger?: string } | undefined;
      const result = await ctx.inject(sessionKey, "/compact", {
        silent: true,
        onStream: (msg: StreamMessage) => {
          if (msg.type === "system" && msg.subtype === "compact_boundary" && msg.metadata) {
            compactMetadata = msg.metadata as {
              pre_tokens?: number;
              trigger?: string;
            };
          }
        },
      });

      let response = "*Session Compacted*\n\n";
      if (compactMetadata?.pre_tokens) {
        response += `Compressed from ~${Math.round(compactMetadata.pre_tokens / 1000)}k tokens\n`;
        response += `Trigger: ${compactMetadata.trigger || "manual"}`;
      } else {
        response += result || "Context has been compacted.";
      }

      await respond({ response_type: "ephemeral", text: response });
    } catch (_error: unknown) {
      await respond({
        response_type: "ephemeral",
        text: "Failed to compact session.",
      });
    }
  });

  // /think — set thinking level
  boltApp.command("/think", async ({ command, ack, respond }) => {
    await ack();
    if (!(await requireAuth(command, respond))) return;
    const level = command.text.trim().toLowerCase();
    const validLevels = ["off", "minimal", "low", "medium", "high", "xhigh"];
    if (!level) {
      const sessionKey = sessionKeyFromCommand(command.channel_id, command.user_id);
      const state = getSessionState(sessionKey);
      await respond({
        response_type: "ephemeral",
        text: `*Current thinking level:* ${state.thinkingLevel}\n\nUsage: \`/think <level>\`\nValid levels: ${validLevels.join(", ")}`,
      });
      return;
    }
    if (!validLevels.includes(level)) {
      await respond({
        response_type: "ephemeral",
        text: `Invalid thinking level: \`${level}\`\n\nValid levels: ${validLevels.join(", ")}`,
      });
      return;
    }
    const sessionKey = sessionKeyFromCommand(command.channel_id, command.user_id);
    const state = getSessionState(sessionKey);
    state.thinkingLevel = level;
    await respond({
      response_type: "ephemeral",
      text: `*Thinking level set to:* ${level}`,
    });
  });

  // /verbose — toggle verbose mode
  boltApp.command("/verbose", async ({ command, ack, respond }) => {
    await ack();
    if (!(await requireAuth(command, respond))) return;
    const input = command.text.trim().toLowerCase();
    const sessionKey = sessionKeyFromCommand(command.channel_id, command.user_id);
    const state = getSessionState(sessionKey);

    if (input === "on" || input === "true" || input === "1") {
      state.verbose = true;
    } else if (input === "off" || input === "false" || input === "0") {
      state.verbose = false;
    } else {
      // Toggle when no argument
      state.verbose = !state.verbose;
    }

    await respond({
      response_type: "ephemeral",
      text: state.verbose ? "*Verbose mode enabled*" : "*Verbose mode disabled*",
    });
  });

  // /usage — set usage tracking mode
  boltApp.command("/usage", async ({ command, ack, respond }) => {
    await ack();
    if (!(await requireAuth(command, respond))) return;
    const mode = command.text.trim().toLowerCase();
    const validModes = ["off", "tokens", "full"];
    if (!mode) {
      const sessionKey = sessionKeyFromCommand(command.channel_id, command.user_id);
      const state = getSessionState(sessionKey);
      await respond({
        response_type: "ephemeral",
        text: `*Current usage mode:* ${state.usageMode}\n\nUsage: \`/usage <mode>\`\nValid modes: ${validModes.join(", ")}`,
      });
      return;
    }
    if (!validModes.includes(mode)) {
      await respond({
        response_type: "ephemeral",
        text: `Invalid usage mode: \`${mode}\`\n\nValid modes: ${validModes.join(", ")}`,
      });
      return;
    }
    const sessionKey = sessionKeyFromCommand(command.channel_id, command.user_id);
    const state = getSessionState(sessionKey);
    state.usageMode = mode;
    await respond({
      response_type: "ephemeral",
      text: `*Usage tracking set to:* ${mode}`,
    });
  });

  // /model — switch AI model
  boltApp.command("/model", async ({ command, ack, respond }) => {
    await ack();
    const ctx = await requireAuth(command, respond);
    if (!ctx) return;

    const modelChoice = command.text.trim();
    if (!modelChoice) {
      const models = getAllModels(ctx);
      const list =
        models.length > 0
          ? models.map((m) => `\`${m.id}\` -- ${m.name}`).join("\n")
          : "_No models discovered yet. Try again in a moment._";
      await respond({
        response_type: "ephemeral",
        text: `*Available models:*\n${list}\n\nUsage: \`/model <name>\``,
      });
      return;
    }

    const resolved = resolveModel(ctx, modelChoice);
    if (!resolved) {
      const models = getAllModels(ctx);
      const list =
        models.length > 0 ? models.map((m) => `\`${m.id}\` -- ${m.name}`).join("\n") : "_No models discovered yet._";
      await respond({
        response_type: "ephemeral",
        text: `Unknown model: \`${modelChoice}\`\n\n*Available models:*\n${list}`,
      });
      return;
    }

    const sessionKey = sessionKeyFromCommand(command.channel_id, command.user_id);
    const state = getSessionState(sessionKey);

    const ctxRecord = ctx as unknown as Record<string, unknown>;
    const maybeSetProvider = ctxRecord.setSessionProvider;
    const setProvider =
      typeof maybeSetProvider === "function"
        ? (maybeSetProvider as (session: string, provider: string, options?: { model?: string }) => Promise<void>)
        : undefined;
    if (setProvider) {
      try {
        await setProvider(sessionKey, resolved.provider, {
          model: resolved.id,
        });
        state.model = resolved.id;
      } catch (error: unknown) {
        await respond({
          response_type: "ephemeral",
          text: `Failed to switch model: ${error instanceof Error ? error.message : String(error)}`,
        });
        return;
      }
    } else {
      state.model = resolved.id;
    }

    await respond({
      response_type: "ephemeral",
      text: `*Model switched to:* ${resolved.name} (\`${resolved.id}\`)`,
    });
  });

  // /session — switch to a named session
  boltApp.command("/session", async ({ command, ack, respond }) => {
    await ack();
    if (!(await requireAuth(command, respond))) return;
    const name = command.text.trim();
    if (!name) {
      await respond({
        response_type: "ephemeral",
        text: "Usage: `/session <name>` or `/session default`\n\nSwitch to a named session. Each session maintains separate context.\nUse `/session default` to return to the default session.",
      });
      return;
    }

    const base = baseSessionKey(command.channel_id, command.user_id);

    if (name === "default") {
      sessionOverrides.delete(base);
      await respond({
        response_type: "ephemeral",
        text: `*Switched to default session:* ${base}`,
      });
      return;
    }

    const newSessionKey = `${base}/${name}`;
    sessionOverrides.set(base, newSessionKey);
    await respond({
      response_type: "ephemeral",
      text: `*Switched to session:* ${newSessionKey}\n\nEach session maintains separate context.`,
    });
  });

  // /cancel — cancel the current AI response
  boltApp.command("/cancel", async ({ command, ack, respond }) => {
    await ack();
    const ctx = await requireAuth(command, respond);
    if (!ctx) return;

    const sessionKey = sessionKeyFromCommand(command.channel_id, command.user_id);
    let cancelled = false;
    if (ctx.cancelInject) {
      cancelled = ctx.cancelInject(sessionKey);
    }

    if (cancelled) {
      await respond({
        response_type: "ephemeral",
        text: "*Cancelled*\n\nThe current response has been stopped.",
      });
    } else {
      await respond({
        response_type: "ephemeral",
        text: "*Nothing to cancel*\n\nNo response is currently in progress.",
      });
    }
  });

  // /help — show available commands
  boltApp.command("/help", async ({ ack, respond }) => {
    await ack();
    await respond({
      response_type: "ephemeral",
      text:
        "*WOPR Slack Commands*\n\n" +
        "`/status` -- Show session status and configuration\n" +
        "`/new` -- Start a fresh session (reset conversation)\n" +
        "`/compact` -- Compact/summarize conversation context\n" +
        "`/think <level>` -- Set thinking level (off/minimal/low/medium/high/xhigh)\n" +
        "`/verbose [on/off]` -- Toggle verbose mode\n" +
        "`/usage <mode>` -- Set usage tracking (off/tokens/full)\n" +
        "`/model [name]` -- Switch AI model (e.g. opus, haiku, sonnet)\n" +
        "`/cancel` -- Stop the current AI response\n" +
        "`/session <name>` -- Switch to a named session\n" +
        "`/help` -- Show this help",
    });
  });
}
