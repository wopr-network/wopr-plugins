/**
 * Typing Indicator Manager for Slack
 *
 * Slack has no native bot typing indicator API like Discord's `sendTyping()`.
 * Instead, we simulate typing by periodically updating a placeholder message
 * with animated dots. This gives users visual feedback that the bot is processing.
 *
 * Mirrors the pattern from wopr-plugin-discord's TypingState manager:
 * - Start typing when processing begins
 * - Refresh indicator on interval
 * - Stop on completion, error, or idle timeout
 */

import type { RetryOptions } from "./retry.js";
import { withRetry } from "./retry.js";

const TYPING_REFRESH_MS = 3000; // Refresh every 3s (Slack rate limits are tighter than Discord)
const TYPING_IDLE_TIMEOUT_MS = 30000; // Stop after 30s of no activity
const TYPING_FRAMES = ["_Thinking._", "_Thinking.._", "_Thinking..._"];

export interface TypingIndicatorDeps {
  /** Update an existing Slack message */
  chatUpdate(params: { channel: string; ts: string; text: string }): Promise<unknown>;
  /** Retry options for API calls */
  retryOpts: RetryOptions;
  /** Logger */
  logger: { debug(obj: Record<string, unknown>): void };
}

export interface TypingState {
  channelId: string;
  messageTs: string;
  interval: ReturnType<typeof setInterval> | null;
  lastActivity: number;
  active: boolean;
  frameIndex: number;
}

const activeIndicators = new Map<string, TypingState>();

/**
 * Start showing a typing indicator by periodically updating the placeholder message.
 * Returns the TypingState for external management.
 */
export function startTyping(key: string, channelId: string, messageTs: string, deps: TypingIndicatorDeps): TypingState {
  // Clean up any existing indicator for this key
  stopTyping(key);

  const state: TypingState = {
    channelId,
    messageTs,
    interval: null,
    lastActivity: Date.now(),
    active: true,
    frameIndex: 0,
  };

  // Set up refresh interval
  state.interval = setInterval(async () => {
    if (!state.active) {
      stopTyping(key);
      return;
    }

    const now = Date.now();
    const idleTime = now - state.lastActivity;

    // Stop if idle for too long
    if (idleTime > TYPING_IDLE_TIMEOUT_MS) {
      deps.logger.debug({
        msg: "Typing indicator stopped (idle)",
        key,
        idleTime,
      });
      stopTyping(key);
      return;
    }

    // Cycle through animation frames
    state.frameIndex = (state.frameIndex + 1) % TYPING_FRAMES.length;
    const text = TYPING_FRAMES[state.frameIndex];

    try {
      await withRetry(
        () =>
          deps.chatUpdate({
            channel: state.channelId,
            ts: state.messageTs,
            text,
          }),
        deps.retryOpts,
      );
    } catch (_e) {
      // Message might be gone, stop the indicator
      stopTyping(key);
    }
  }, TYPING_REFRESH_MS);

  activeIndicators.set(key, state);
  return state;
}

/**
 * Update activity timestamp to prevent idle timeout.
 * Call this when receiving stream chunks.
 */
export function tickTyping(key: string): void {
  const state = activeIndicators.get(key);
  if (state) {
    state.lastActivity = Date.now();
  }
}

/**
 * Stop the typing indicator for a given key.
 */
export function stopTyping(key: string): void {
  const state = activeIndicators.get(key);
  if (state) {
    state.active = false;
    if (state.interval) {
      clearInterval(state.interval);
      state.interval = null;
    }
    activeIndicators.delete(key);
  }
}

/**
 * Check if a typing indicator is active for a given key.
 */
export function isTyping(key: string): boolean {
  return activeIndicators.has(key);
}

/**
 * Stop all active typing indicators. Used during shutdown.
 */
export function stopAllTyping(): void {
  for (const key of activeIndicators.keys()) {
    stopTyping(key);
  }
}

// Export constants for testing
export { TYPING_FRAMES, TYPING_IDLE_TIMEOUT_MS, TYPING_REFRESH_MS };
