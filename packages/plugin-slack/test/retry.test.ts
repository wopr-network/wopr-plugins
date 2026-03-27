import { describe, it, expect, vi, beforeEach } from "vitest";
import {
	withRetry,
	isRateLimitError,
	isTransientError,
	calculateDelay,
} from "../src/retry.js";

describe("retry", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	describe("isRateLimitError", () => {
		it("returns retryAfter for slack_webapi_rate_limited_error", () => {
			const err = { code: "slack_webapi_rate_limited_error", retryAfter: 5 };
			expect(isRateLimitError(err)).toEqual({ retryAfter: 5 });
		});

		it("returns undefined retryAfter when not a number", () => {
			const err = { code: "slack_webapi_rate_limited_error" };
			expect(isRateLimitError(err)).toEqual({ retryAfter: undefined });
		});

		it("detects 429 statusCode", () => {
			const err = { statusCode: 429, retryAfter: 10 };
			expect(isRateLimitError(err)).toEqual({ retryAfter: 10 });
		});

		it("detects 429 status", () => {
			const err = { status: 429 };
			expect(isRateLimitError(err)).toEqual({ retryAfter: undefined });
		});

		it("returns null for non-rate-limit errors", () => {
			expect(isRateLimitError(new Error("generic"))).toBeNull();
			expect(isRateLimitError(null)).toBeNull();
			expect(isRateLimitError(undefined)).toBeNull();
			expect(isRateLimitError({ code: "other_error" })).toBeNull();
		});
	});

	describe("isTransientError", () => {
		it("returns true for rate limit errors", () => {
			expect(
				isTransientError({ code: "slack_webapi_rate_limited_error" }),
			).toBe(true);
		});

		it("returns true for network errors", () => {
			expect(isTransientError({ code: "ECONNRESET" })).toBe(true);
			expect(isTransientError({ code: "ECONNREFUSED" })).toBe(true);
			expect(isTransientError({ code: "ETIMEDOUT" })).toBe(true);
			expect(isTransientError({ code: "ENOTFOUND" })).toBe(true);
			expect(isTransientError({ code: "EAI_AGAIN" })).toBe(true);
		});

		it("returns true for 5xx errors", () => {
			expect(isTransientError({ statusCode: 500 })).toBe(true);
			expect(isTransientError({ statusCode: 502 })).toBe(true);
			expect(isTransientError({ statusCode: 503 })).toBe(true);
			expect(isTransientError({ status: 500 })).toBe(true);
		});

		it("returns false for non-transient errors", () => {
			expect(isTransientError(new Error("bad input"))).toBe(false);
			expect(isTransientError({ statusCode: 400 })).toBe(false);
			expect(isTransientError({ statusCode: 404 })).toBe(false);
			expect(isTransientError(null)).toBe(false);
			expect(isTransientError(undefined)).toBe(false);
		});
	});

	describe("calculateDelay", () => {
		it("uses exponential backoff", () => {
			// With jitter, the result is between baseDelay*2^attempt and baseDelay*2^attempt + baseDelay
			vi.spyOn(Math, "random").mockReturnValue(0);
			expect(calculateDelay(0, 1000, 30000)).toBe(1000); // 1000 * 2^0 + 0
			expect(calculateDelay(1, 1000, 30000)).toBe(2000); // 1000 * 2^1 + 0
			expect(calculateDelay(2, 1000, 30000)).toBe(4000); // 1000 * 2^2 + 0
			expect(calculateDelay(3, 1000, 30000)).toBe(8000); // 1000 * 2^3 + 0
		});

		it("caps at maxDelay", () => {
			vi.spyOn(Math, "random").mockReturnValue(0);
			expect(calculateDelay(10, 1000, 30000)).toBe(30000);
		});

		it("uses retryAfter when provided", () => {
			expect(calculateDelay(0, 1000, 30000, 5000)).toBe(5000);
		});

		it("caps retryAfter at maxDelay", () => {
			expect(calculateDelay(0, 1000, 30000, 60000)).toBe(30000);
		});

		it("includes jitter", () => {
			vi.spyOn(Math, "random").mockReturnValue(0.5);
			// 1000 * 2^0 + 0.5 * 1000 = 1500
			expect(calculateDelay(0, 1000, 30000)).toBe(1500);
		});
	});

	describe("withRetry", () => {
		it("returns result on first success", async () => {
			const fn = vi.fn().mockResolvedValue("ok");
			const result = await withRetry(fn, { maxRetries: 3 });
			expect(result).toBe("ok");
			expect(fn).toHaveBeenCalledTimes(1);
		});

		it("retries on rate limit error and succeeds", async () => {
			vi.spyOn(Math, "random").mockReturnValue(0);
			const fn = vi
				.fn()
				.mockRejectedValueOnce({
					code: "slack_webapi_rate_limited_error",
					retryAfter: 0.001,
				})
				.mockResolvedValue("ok");

			const onRetry = vi.fn();
			const result = await withRetry(fn, {
				maxRetries: 3,
				baseDelay: 1,
				maxDelay: 100,
				onRetry,
			});

			expect(result).toBe("ok");
			expect(fn).toHaveBeenCalledTimes(2);
			expect(onRetry).toHaveBeenCalledTimes(1);
			expect(onRetry).toHaveBeenCalledWith(1, expect.any(Number), expect.anything());
		});

		it("retries on transient network error", async () => {
			const fn = vi
				.fn()
				.mockRejectedValueOnce({ code: "ECONNRESET" })
				.mockResolvedValue("recovered");

			const result = await withRetry(fn, {
				maxRetries: 2,
				baseDelay: 1,
				maxDelay: 10,
			});

			expect(result).toBe("recovered");
			expect(fn).toHaveBeenCalledTimes(2);
		});

		it("retries on 5xx server error", async () => {
			const fn = vi
				.fn()
				.mockRejectedValueOnce({ statusCode: 502 })
				.mockResolvedValue("recovered");

			const result = await withRetry(fn, {
				maxRetries: 2,
				baseDelay: 1,
				maxDelay: 10,
			});

			expect(result).toBe("recovered");
			expect(fn).toHaveBeenCalledTimes(2);
		});

		it("throws immediately on non-transient error", async () => {
			const fn = vi.fn().mockRejectedValue(new Error("bad request"));

			await expect(
				withRetry(fn, { maxRetries: 3, baseDelay: 1, maxDelay: 10 }),
			).rejects.toThrow("bad request");

			expect(fn).toHaveBeenCalledTimes(1);
		});

		it("throws after exhausting all retries", async () => {
			const rateLimitErr = { code: "slack_webapi_rate_limited_error", retryAfter: 0.001 };
			const fn = vi.fn().mockRejectedValue(rateLimitErr);

			await expect(
				withRetry(fn, { maxRetries: 2, baseDelay: 1, maxDelay: 10 }),
			).rejects.toBe(rateLimitErr);

			// initial + 2 retries = 3
			expect(fn).toHaveBeenCalledTimes(3);
		});

		it("uses default config when no options provided", async () => {
			const fn = vi.fn().mockResolvedValue("default");
			const result = await withRetry(fn);
			expect(result).toBe("default");
		});

		it("calls onRetry for each retry attempt", async () => {
			const rateLimitErr = { code: "slack_webapi_rate_limited_error", retryAfter: 0.001 };
			const fn = vi
				.fn()
				.mockRejectedValueOnce(rateLimitErr)
				.mockRejectedValueOnce(rateLimitErr)
				.mockResolvedValue("ok");

			const onRetry = vi.fn();
			await withRetry(fn, {
				maxRetries: 3,
				baseDelay: 1,
				maxDelay: 10,
				onRetry,
			});

			expect(onRetry).toHaveBeenCalledTimes(2);
			expect(onRetry).toHaveBeenNthCalledWith(1, 1, expect.any(Number), rateLimitErr);
			expect(onRetry).toHaveBeenNthCalledWith(2, 2, expect.any(Number), rateLimitErr);
		});

		it("respects retryAfter from rate limit error", async () => {
			vi.spyOn(Math, "random").mockReturnValue(0);
			const fn = vi
				.fn()
				.mockRejectedValueOnce({
					code: "slack_webapi_rate_limited_error",
					retryAfter: 0.001, // 1ms in seconds
				})
				.mockResolvedValue("ok");

			const onRetry = vi.fn();
			await withRetry(fn, {
				maxRetries: 1,
				baseDelay: 1,
				maxDelay: 100,
				onRetry,
			});

			expect(onRetry).toHaveBeenCalledWith(1, 1, expect.anything());
		});
	});
});
