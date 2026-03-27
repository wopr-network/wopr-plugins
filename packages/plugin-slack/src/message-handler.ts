/**
 * Message Handler
 *
 * Core message processing: shouldRespond logic, handleMessage orchestration,
 * and streaming message update/finalize helpers.
 */

import type { App, Context, SayFn } from "@slack/bolt";
import type { Logger } from "winston";
import { type SlackFile, saveAttachments } from "./attachments.js";
import { getEffectiveSessionKey, incrementMessageCount } from "./commands.js";
import {
  approveUser,
  buildPairingMessage,
  checkRequestRateLimit,
  claimPairingCode,
  createPairingRequest,
  isUserAllowed,
} from "./pairing.js";
import { withRetry } from "./retry.js";
import type { AgentIdentity, SlackConfig, StreamMessage, WOPRPluginContext } from "./types.js";
import { startTyping, stopTyping } from "./typing.js";

/** Slack message shape as received by handlers */
type SlackMessage = Record<string, unknown> & {
  text?: string;
  user?: string;
  ts?: string;
  subtype?: string;
  bot_id?: string;
  thread_ts?: string;
  files?: unknown[];
  user_profile?: { display_name?: string };
};

/** Bolt context extended with channel (added by Slack event middleware) */
type SlackContext = Context & { channel?: string; botUserId?: string };

// Constants
const SLACK_LIMIT = 4000;
const EDIT_THRESHOLD = 1500;
const IDLE_SPLIT_MS = 1000;

/** Track active streaming sessions */
export interface StreamState {
  channelId: string;
  threadTs?: string;
  messageTs: string;
  buffer: string;
  lastEdit: number;
  isFinalized: boolean;
}

export const activeStreams = new Map<string, StreamState>();

/** Dependencies injected from index.ts */
export interface MessageHandlerDeps {
  getApp: () => App | null;
  getCtx: () => WOPRPluginContext | null;
  getStoredBotToken: () => string;
  retryOpts: (label: string) => Record<string, unknown>;
  logger: Logger;
  agentIdentity: AgentIdentity;
}

/**
 * Update a Slack message with new content
 */
async function updateMessage(state: StreamState, content: string, deps: MessageHandlerDeps): Promise<void> {
  const app = deps.getApp();
  if (!app || state.isFinalized) return;

  let text = content;
  if (text.length > SLACK_LIMIT) {
    text = `${text.substring(0, SLACK_LIMIT - 3)}...`;
  }

  try {
    await withRetry(
      () =>
        app.client.chat.update({
          channel: state.channelId,
          ts: state.messageTs,
          text,
        }),
      deps.retryOpts("chat.update:stream"),
    );
    state.lastEdit = Date.now();
  } catch (error: unknown) {
    deps.logger.warn({ msg: "Failed to update message", error: String(error) });
  }
}

/**
 * Finalize a Slack message
 */
async function finalizeMessage(state: StreamState, content: string, deps: MessageHandlerDeps): Promise<void> {
  const app = deps.getApp();
  if (!app || state.isFinalized) return;
  state.isFinalized = true;

  let text = content;
  if (text.length > SLACK_LIMIT) {
    text = `${text.substring(0, SLACK_LIMIT - 3)}...`;
  }

  try {
    await withRetry(
      () =>
        app.client.chat.update({
          channel: state.channelId,
          ts: state.messageTs,
          text,
        }),
      deps.retryOpts("chat.update:finalize"),
    );
  } catch (error: unknown) {
    deps.logger.warn({
      msg: "Failed to finalize message",
      error: String(error),
    });
  }
}

/**
 * Get the reaction emoji (from identity or default)
 */
function getAckReaction(config: SlackConfig, agentIdentity: AgentIdentity): string {
  return config.ackReaction?.trim() || agentIdentity.emoji?.trim() || "👀";
}

/**
 * Determine if we should respond to this message
 */
export async function shouldRespond(
  message: SlackMessage,
  context: SlackContext,
  config: SlackConfig,
  deps: MessageHandlerDeps,
): Promise<boolean> {
  const { getApp, getCtx, retryOpts, logger } = deps;
  const app = getApp();
  const ctx = getCtx();

  // Ignore bot messages
  if (message.subtype === "bot_message" || message.bot_id) {
    return false;
  }

  // Ignore message_changed (edits)
  if (message.subtype === "message_changed") {
    return false;
  }

  const isDM = context.channel?.startsWith("D") || false;

  // DM handling
  if (isDM) {
    if (config.dm?.enabled === false) return false;

    const policy = config.dm?.policy || "pairing";
    if (policy === "closed") return false;
    if (policy === "open") return true;

    // Pairing mode - check if user is already approved
    if (ctx && isUserAllowed(ctx, message.user ?? "")) return true;

    // Check if this is a claim attempt (user typing a pairing code)
    const trimmed = (message.text || "").trim().toUpperCase();
    if (/^[A-Z2-9]{8}$/.test(trimmed)) {
      const { request, error } = claimPairingCode(trimmed, message.user, message.user);
      if (request && ctx) {
        try {
          await approveUser(ctx, request.slackUserId);
        } catch (error: unknown) {
          logger.error({
            msg: "Failed to approve user after pairing claim",
            user: message.user,
            error: String(error),
          });
        }
        logger.info({ msg: "Pairing claimed via DM", user: message.user });
        message.__pairingApproved = true;
        return true;
      }
      if (error) {
        logger.debug({
          msg: "Pairing claim failed",
          user: message.user,
          error,
        });
      }
    }

    // Rate-limit pairing requests
    if (!checkRequestRateLimit(message.user ?? "")) {
      logger.info({ msg: "Pairing request rate-limited", user: message.user });
      return false;
    }

    // Generate pairing code and send it to the user
    const username = message.user_profile?.display_name || message.user || "unknown";
    const code = createPairingRequest(message.user ?? "", username);
    const pairingMsg = buildPairingMessage(code);

    logger.info({ msg: "Pairing code issued", user: message.user, code });

    try {
      if (app) {
        await withRetry(
          () =>
            app.client.chat.postMessage({
              channel: context.channel ?? "",
              text: pairingMsg,
            }),
          retryOpts("chat.postMessage:pairing"),
        );
      }
    } catch (error: unknown) {
      logger.warn({
        msg: "Failed to send pairing message",
        error: String(error),
      });
    }

    return false;
  }

  // Channel handling
  const groupPolicy = config.groupPolicy || "allowlist";
  if (groupPolicy === "disabled") return false;
  if (groupPolicy === "open") {
    return message.text?.includes(`<@${context.botUserId}>`) || false;
  }

  // Allowlist mode
  const channelConfig = config.channels?.[context.channel ?? ""];
  if (!channelConfig || channelConfig.enabled === false || channelConfig.allow === false) {
    return false;
  }

  if (channelConfig.requireMention) {
    return message.text?.includes(`<@${context.botUserId}>`) || false;
  }

  return true;
}

/**
 * Handle incoming Slack message
 */
export async function handleMessage(
  message: SlackMessage,
  context: SlackContext,
  say: SayFn,
  config: SlackConfig,
  deps: MessageHandlerDeps,
) {
  const { getApp, getCtx, getStoredBotToken, retryOpts, logger, agentIdentity } = deps;
  const app = getApp();
  const ctx = getCtx();

  logger.debug({
    msg: "RECEIVED MESSAGE",
    text: message.text?.substring(0, 100),
    user: message.user,
    channel: context.channel,
    isDM: context.channel?.startsWith("D"),
  });

  if (!ctx) return;
  if (!app) return;
  const slackApp = app;

  const channelId = context.channel ?? "";
  const messageTs = (message.ts as string | undefined) ?? "";

  const isDM = channelId.startsWith("D");

  // Check if we should respond
  if (!(await shouldRespond(message, context, config, deps))) {
    const sessionKey = getEffectiveSessionKey(channelId, message.user ?? "", isDM);
    try {
      ctx.logMessage(sessionKey, message.text ?? "", {
        from: message.user,
        channel: { type: "slack", id: channelId },
      });
    } catch (_error: unknown) {}
    return;
  }

  // If user was just approved via pairing, send confirmation and return early
  if (message.__pairingApproved) {
    try {
      await say({
        text: "Your account has been paired. I'll respond to your messages from now on.",
      });
    } catch (error: unknown) {
      logger.warn({
        msg: "Failed to send pairing confirmation",
        error: String(error),
      });
    }
    return;
  }

  // Add ack reaction
  const ackEmoji = getAckReaction(config, agentIdentity);
  try {
    await withRetry(
      () =>
        slackApp.client.reactions.add({
          channel: channelId,
          timestamp: messageTs,
          name: ackEmoji.replace(/:/g, ""),
        }),
      retryOpts("reactions.add:ack"),
    );
  } catch (error: unknown) {
    logger.warn({ msg: "Failed to add reaction", error: String(error) });
  }

  const sessionKey = getEffectiveSessionKey(channelId, message.user ?? "", isDM);
  incrementMessageCount(sessionKey);

  // Determine reply threading
  const replyToMode = config.replyToMode || "off";
  const shouldThread = replyToMode === "all" || (replyToMode === "first" && message.thread_ts) || message.thread_ts;

  const streamState: StreamState = {
    channelId,
    threadTs: shouldThread ? (message.thread_ts as string | undefined) || messageTs || undefined : undefined,
    messageTs: "",
    buffer: "",
    lastEdit: 0,
    isFinalized: false,
  };

  activeStreams.set(sessionKey, streamState);

  try {
    const initialResponse = await say({
      text: "_Thinking..._",
      thread_ts: streamState.threadTs,
    });

    streamState.messageTs = initialResponse.ts ?? "";

    startTyping(sessionKey, channelId, streamState.messageTs, {
      chatUpdate: (params) => slackApp.client.chat.update(params),
      retryOpts: retryOpts("chat.update:typing"),
      logger,
    });

    let buffer = "";
    let lastFlush = Date.now();
    let finalizeTimer: NodeJS.Timeout | null = null;

    const handleChunk = async (msg: StreamMessage) => {
      if (streamState.isFinalized) return;

      let textContent = "";
      if (msg.type === "text" && msg.content) {
        textContent = msg.content;
      } else if ((msg.type as string) === "assistant") {
        const msgRecord = msg as unknown as Record<string, unknown>;
        if (msgRecord.message !== null && typeof msgRecord.message === "object") {
          const content = (msgRecord.message as Record<string, unknown>).content;
          if (Array.isArray(content)) {
            textContent = (content as Record<string, unknown>[]).map((c) => c.text || "").join("");
          } else if (typeof content === "string") {
            textContent = content;
          }
        }
      }

      if (!textContent) return;

      stopTyping(sessionKey);

      buffer += textContent;
      const now = Date.now();

      if (now - lastFlush > IDLE_SPLIT_MS && buffer.length > 0) {
        await updateMessage(streamState, buffer, deps);
        buffer = "";
      }

      lastFlush = now;

      if (buffer.length >= EDIT_THRESHOLD) {
        await updateMessage(streamState, buffer, deps);
      }

      if (finalizeTimer) clearTimeout(finalizeTimer);
      finalizeTimer = setTimeout(async () => {
        if (buffer.length > 0 && !streamState.isFinalized) {
          await finalizeMessage(streamState, buffer, deps);
        }
      }, 2000);
    };

    // Handle file attachments
    let messageContent: string = message.text || "";
    const effectiveBotToken = context.botToken || getStoredBotToken();
    if (message.files && Array.isArray(message.files) && message.files.length > 0 && effectiveBotToken) {
      const attachmentPaths = await saveAttachments(
        message.files as SlackFile[],
        message.user ?? "",
        effectiveBotToken,
        logger,
      );
      if (attachmentPaths.length > 0) {
        const attachmentInfo = attachmentPaths.map((p: string) => `[Attachment: ${p}]`).join("\n");
        messageContent = messageContent ? `${messageContent}\n\n${attachmentInfo}` : attachmentInfo;
        logger.info({
          msg: "Attachments appended to message",
          count: attachmentPaths.length,
          channel: channelId,
        });
      }
    }

    if (!messageContent.trim()) {
      logger.warn({
        msg: "Skipping inject — message content is empty after attachment handling",
        user: message.user,
        channel: channelId,
      });
      try {
        await withRetry(
          () =>
            slackApp.client.chat.delete({
              channel: streamState.channelId,
              ts: streamState.messageTs,
            }),
          retryOpts("chat.delete:empty"),
        );
      } catch (_error: unknown) {}
      return;
    }

    const response = await ctx.inject(sessionKey, messageContent, {
      from: message.user,
      channel: { type: "slack", id: channelId },
      onStream: handleChunk,
    });

    stopTyping(sessionKey);
    if (finalizeTimer) clearTimeout(finalizeTimer);
    if (!streamState.isFinalized) {
      const finalText = buffer || response;
      await finalizeMessage(streamState, finalText, deps);
    }

    try {
      await withRetry(
        () =>
          slackApp.client.reactions.remove({
            channel: channelId,
            timestamp: messageTs,
            name: ackEmoji.replace(/:/g, ""),
          }),
        retryOpts("reactions.remove:ack"),
      );
      await withRetry(
        () =>
          slackApp.client.reactions.add({
            channel: channelId,
            timestamp: messageTs,
            name: "white_check_mark",
          }),
        retryOpts("reactions.add:success"),
      );
    } catch (_error: unknown) {}
  } catch (error: unknown) {
    stopTyping(sessionKey);
    logger.error({ msg: "Inject failed", error: String(error) });

    try {
      await withRetry(
        () =>
          slackApp.client.chat.update({
            channel: streamState.channelId,
            ts: streamState.messageTs,
            text: "❌ Error processing your request. Please try again.",
          }),
        retryOpts("chat.update:error"),
      );
    } catch (_error: unknown) {}

    try {
      await withRetry(
        () =>
          slackApp.client.reactions.remove({
            channel: channelId,
            timestamp: messageTs,
            name: ackEmoji.replace(/:/g, ""),
          }),
        retryOpts("reactions.remove:ack-error"),
      );
      await withRetry(
        () =>
          slackApp.client.reactions.add({
            channel: channelId,
            timestamp: messageTs,
            name: "x",
          }),
        retryOpts("reactions.add:error"),
      );
    } catch (_error: unknown) {}
  } finally {
    activeStreams.delete(sessionKey);
  }
}
