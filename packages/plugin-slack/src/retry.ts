/**
 * Retry wrapper with exponential backoff for Slack API calls.
 *
 * Detects 429 rate-limit responses and retries with exponential
 * backoff plus jitter. Also retries on transient network errors.
 */

import type { RetryConfig } from "./types.js";

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_BASE_DELAY = 1000; // 1 second
const DEFAULT_MAX_DELAY = 30000; // 30 seconds

export interface RetryOptions extends RetryConfig {
  /** Called on each retry attempt for logging */
  onRetry?: (attempt: number, delay: number, error: unknown) => void;
}

/**
 * Check if an error is a Slack 429 rate-limit error.
 * Slack's WebClient throws errors with a `code` of 'slack_webapi_platform_error'
 * or 'slack_webapi_rate_limited_error' and may include `retryAfter`.
 */
function isRateLimitError(error: unknown): { retryAfter?: number } | null {
  if (error == null || typeof error !== "object") return null;
  const err = error as Record<string, unknown>;

  // Slack WebClient rate limit errors have code 'slack_webapi_rate_limited_error'
  // and include a retryAfter field (seconds)
  if (err.code === "slack_webapi_rate_limited_error") {
    return {
      retryAfter: typeof err.retryAfter === "number" ? err.retryAfter : undefined,
    };
  }

  // Also check for HTTP 429 status on generic errors
  if (err.statusCode === 429 || err.status === 429) {
    const headers = err.headers as Record<string, string> | undefined;
    const retryAfter =
      typeof err.retryAfter === "number"
        ? err.retryAfter
        : typeof headers?.["retry-after"] === "string"
          ? Number.parseInt(headers["retry-after"], 10)
          : undefined;
    return { retryAfter: Number.isNaN(retryAfter) ? undefined : retryAfter };
  }

  return null;
}

/**
 * Check if an error is transient and worth retrying.
 */
function isTransientError(error: unknown): boolean {
  if (isRateLimitError(error)) return true;
  if (error == null || typeof error !== "object") return false;

  const err = error as Record<string, unknown>;
  const code = err.code as string | undefined;

  // Network/connection errors
  if (
    code === "ECONNRESET" ||
    code === "ECONNREFUSED" ||
    code === "ETIMEDOUT" ||
    code === "ENOTFOUND" ||
    code === "EAI_AGAIN"
  ) {
    return true;
  }

  // HTTP 5xx server errors
  const status = (err.statusCode ?? err.status) as number | undefined;
  if (typeof status === "number" && status >= 500 && status < 600) {
    return true;
  }

  return false;
}

/**
 * Calculate backoff delay with jitter.
 * delay = min(baseDelay * 2^attempt + jitter, maxDelay)
 */
function calculateDelay(attempt: number, baseDelay: number, maxDelay: number, retryAfterMs?: number): number {
  // If server told us how long to wait, respect it
  if (retryAfterMs !== undefined && retryAfterMs > 0) {
    return Math.min(retryAfterMs, maxDelay);
  }

  const exponential = baseDelay * 2 ** attempt;
  const jitter = Math.random() * baseDelay;
  return Math.min(exponential + jitter, maxDelay);
}

/**
 * Execute an async function with retry and exponential backoff.
 *
 * @param fn - The async function to execute
 * @param options - Retry configuration
 * @returns The result of the function
 * @throws The last error if all retries are exhausted
 */
export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  const baseDelay = options.baseDelay ?? DEFAULT_BASE_DELAY;
  const maxDelay = options.maxDelay ?? DEFAULT_MAX_DELAY;

  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: unknown) {
      lastError = error;

      // Don't retry if we've exhausted attempts
      if (attempt >= maxRetries) {
        break;
      }

      // Only retry on transient errors
      if (!isTransientError(error)) {
        break;
      }

      // Calculate delay
      const rateLimit = isRateLimitError(error);
      const retryAfterMs = rateLimit?.retryAfter ? rateLimit.retryAfter * 1000 : undefined;
      const delay = calculateDelay(attempt, baseDelay, maxDelay, retryAfterMs);

      if (options.onRetry) {
        options.onRetry(attempt + 1, delay, error);
      }

      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}

export { calculateDelay, isRateLimitError, isTransientError };
