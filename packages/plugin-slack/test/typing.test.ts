import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
	startTyping,
	stopTyping,
	tickTyping,
	isTyping,
	stopAllTyping,
	TYPING_REFRESH_MS,
	TYPING_IDLE_TIMEOUT_MS,
	TYPING_FRAMES,
} from "../src/typing.js";

function makeDeps() {
	return {
		chatUpdate: vi.fn().mockResolvedValue({}),
		retryOpts: { maxRetries: 0, baseDelay: 1, maxDelay: 10 },
		logger: { debug: vi.fn() },
	};
}

describe("typing indicator", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		stopAllTyping();
	});

	afterEach(() => {
		stopAllTyping();
		vi.useRealTimers();
	});

	it("starts and registers an active indicator", () => {
		const deps = makeDeps();
		const state = startTyping("key1", "C123", "ts123", deps);

		expect(state.active).toBe(true);
		expect(state.channelId).toBe("C123");
		expect(state.messageTs).toBe("ts123");
		expect(isTyping("key1")).toBe(true);
	});

	it("updates message with animated frames on interval", async () => {
		const deps = makeDeps();
		startTyping("key2", "C123", "ts123", deps);

		// Advance past first interval
		await vi.advanceTimersByTimeAsync(TYPING_REFRESH_MS);

		expect(deps.chatUpdate).toHaveBeenCalledWith({
			channel: "C123",
			ts: "ts123",
			text: TYPING_FRAMES[1], // Second frame (index cycles 0 -> 1)
		});

		// Advance past second interval
		await vi.advanceTimersByTimeAsync(TYPING_REFRESH_MS);

		expect(deps.chatUpdate).toHaveBeenCalledWith({
			channel: "C123",
			ts: "ts123",
			text: TYPING_FRAMES[2], // Third frame
		});

		// Advance past third interval - wraps back to first frame
		await vi.advanceTimersByTimeAsync(TYPING_REFRESH_MS);

		expect(deps.chatUpdate).toHaveBeenCalledWith({
			channel: "C123",
			ts: "ts123",
			text: TYPING_FRAMES[0], // Wraps back
		});
	});

	it("stops when stopTyping is called", async () => {
		const deps = makeDeps();
		startTyping("key3", "C123", "ts123", deps);

		stopTyping("key3");

		expect(isTyping("key3")).toBe(false);

		// Advance time - should not call chatUpdate after stop
		await vi.advanceTimersByTimeAsync(TYPING_REFRESH_MS * 2);
		expect(deps.chatUpdate).not.toHaveBeenCalled();
	});

	it("stops after idle timeout", async () => {
		const deps = makeDeps();
		startTyping("key4", "C123", "ts123", deps);

		// Advance past idle timeout (need enough intervals to reach it)
		const intervals = Math.ceil(TYPING_IDLE_TIMEOUT_MS / TYPING_REFRESH_MS) + 1;
		for (let i = 0; i < intervals; i++) {
			await vi.advanceTimersByTimeAsync(TYPING_REFRESH_MS);
		}

		expect(isTyping("key4")).toBe(false);
	});

	it("tickTyping resets the idle timer", async () => {
		const deps = makeDeps();
		startTyping("key5", "C123", "ts123", deps);

		// Advance close to idle timeout
		const nearTimeout = TYPING_IDLE_TIMEOUT_MS - TYPING_REFRESH_MS;
		await vi.advanceTimersByTimeAsync(nearTimeout);

		// Tick to reset activity
		tickTyping("key5");

		// Advance another interval — should still be active because we ticked
		await vi.advanceTimersByTimeAsync(TYPING_REFRESH_MS);

		expect(isTyping("key5")).toBe(true);
	});

	it("stopAllTyping clears all indicators", () => {
		const deps = makeDeps();
		startTyping("a", "C1", "ts1", deps);
		startTyping("b", "C2", "ts2", deps);
		startTyping("c", "C3", "ts3", deps);

		expect(isTyping("a")).toBe(true);
		expect(isTyping("b")).toBe(true);
		expect(isTyping("c")).toBe(true);

		stopAllTyping();

		expect(isTyping("a")).toBe(false);
		expect(isTyping("b")).toBe(false);
		expect(isTyping("c")).toBe(false);
	});

	it("starting with same key stops previous indicator", async () => {
		const deps = makeDeps();
		const state1 = startTyping("dup", "C1", "ts1", deps);
		const state2 = startTyping("dup", "C2", "ts2", deps);

		expect(state1.active).toBe(false);
		expect(state2.active).toBe(true);
		expect(isTyping("dup")).toBe(true);
	});

	it("stops if chatUpdate throws", async () => {
		const deps = makeDeps();
		deps.chatUpdate.mockRejectedValue(new Error("channel_not_found"));

		startTyping("errkey", "C404", "ts404", deps);

		// Advance to trigger first update attempt
		await vi.advanceTimersByTimeAsync(TYPING_REFRESH_MS);

		// Should have stopped after the error
		expect(isTyping("errkey")).toBe(false);
	});

	it("stopTyping is safe to call on non-existent key", () => {
		expect(() => stopTyping("nonexistent")).not.toThrow();
	});

	it("tickTyping is safe to call on non-existent key", () => {
		expect(() => tickTyping("nonexistent")).not.toThrow();
	});

	it("isTyping returns false for non-existent key", () => {
		expect(isTyping("nope")).toBe(false);
	});
});
