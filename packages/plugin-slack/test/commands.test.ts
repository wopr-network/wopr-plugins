import { describe, it, expect, vi, beforeEach } from "vitest";
import type { App } from "@slack/bolt";
import type { WOPRPluginContext } from "../src/types.js";
import {
	registerSlashCommands,
	getSessionState,
	resetSession,
	incrementMessageCount,
	getEffectiveSessionKey,
} from "../src/commands.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal mock WOPRPluginContext */
function mockContext(
	overrides: Partial<WOPRPluginContext> = {},
): WOPRPluginContext {
	return {
		inject: vi.fn().mockResolvedValue("compacted"),
		logMessage: vi.fn(),
		injectPeer: vi.fn(),
		getIdentity: () => ({ publicKey: "pk", shortId: "id", encryptPub: "ep" }),
		getAgentIdentity: vi.fn().mockResolvedValue({ name: "WOPR", emoji: "👀" }),
		getUserProfile: () => ({}),
		getSessions: () => [],
		getPeers: () => [],
		getConfig: () =>
			({ channels: { slack: { dm: { allowFrom: ["U_AUTH"] } } } }) as any,
		saveConfig: vi.fn(),
		getMainConfig: () => ({}),
		registerConfigSchema: vi.fn(),
		getPluginDir: () => "/tmp",
		log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
		getProvider: vi.fn((id: string) => {
			if (id === "anthropic") {
				return {
					id: "anthropic",
					name: "Anthropic",
					supportedModels: [
						"claude-sonnet-4-20250514",
						"claude-opus-4-20250514",
						"claude-haiku-4-20250514",
					],
				};
			}
			if (id === "openai") {
				return {
					id: "openai",
					name: "OpenAI",
					supportedModels: ["gpt-4o", "o3"],
				};
			}
			return undefined;
		}),
		setSessionProvider: vi.fn(),
		cancelInject: vi.fn().mockReturnValue(false),
		...overrides,
	};
}

/** Captured command handlers keyed by command name (e.g. "/status") */
type CommandHandler = (args: {
	command: any;
	ack: () => Promise<void>;
	respond: (msg: any) => Promise<void>;
}) => Promise<void>;

function createMockBoltApp(): { app: App; handlers: Map<string, CommandHandler> } {
	const handlers = new Map<string, CommandHandler>();
	const app = {
		command: vi.fn((name: string, handler: CommandHandler) => {
			handlers.set(name, handler);
		}),
	} as unknown as App;
	return { app, handlers };
}

function makeCommand(
	channelId: string,
	userId: string,
	text = "",
): { command: any; ack: ReturnType<typeof vi.fn>; respond: ReturnType<typeof vi.fn> } {
	return {
		command: {
			channel_id: channelId,
			user_id: userId,
			text,
		},
		ack: vi.fn(),
		respond: vi.fn(),
	};
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("registerSlashCommands", () => {
	let ctx: WOPRPluginContext;
	let handlers: Map<string, CommandHandler>;

	beforeEach(() => {
		ctx = mockContext();
		const mock = createMockBoltApp();
		handlers = mock.handlers;
		registerSlashCommands(mock.app, () => ctx);
	});

	it("registers all 10 slash commands", () => {
		const expected = [
			"/status",
			"/new",
			"/compact",
			"/think",
			"/verbose",
			"/usage",
			"/model",
			"/session",
			"/cancel",
			"/help",
		];
		for (const cmd of expected) {
			expect(handlers.has(cmd), `${cmd} should be registered`).toBe(true);
		}
		expect(handlers.size).toBe(10);
	});

	// -- Auth gate --------------------------------------------------------

	describe("auth gating", () => {
		it("denies unauthorized user on /status", async () => {
			const { command, ack, respond } = makeCommand("C1", "U_UNAUTH");
			await handlers.get("/status")!({ command, ack, respond });
			expect(ack).toHaveBeenCalled();
			expect(respond).toHaveBeenCalledWith(
				expect.objectContaining({
					response_type: "ephemeral",
					text: expect.stringContaining("not authorized"),
				}),
			);
		});

		it("denies when ctx is null", async () => {
			const nullMock = createMockBoltApp();
			registerSlashCommands(nullMock.app, () => null);
			const { command, ack, respond } = makeCommand("C1", "U_AUTH");
			await nullMock.handlers.get("/status")!({ command, ack, respond });
			expect(respond).toHaveBeenCalledWith(
				expect.objectContaining({
					text: expect.stringContaining("not ready"),
				}),
			);
		});
	});

	// -- /status ----------------------------------------------------------

	describe("/status", () => {
		it("shows session status for authorized user", async () => {
			const { command, ack, respond } = makeCommand("C1", "U_AUTH");
			await handlers.get("/status")!({ command, ack, respond });
			expect(ack).toHaveBeenCalled();
			expect(respond).toHaveBeenCalledWith(
				expect.objectContaining({
					response_type: "ephemeral",
					text: expect.stringContaining("Session Status"),
				}),
			);
		});

		it("includes model, thinking level, and message count", async () => {
			const { command, ack, respond } = makeCommand("C1", "U_AUTH");
			await handlers.get("/status")!({ command, ack, respond });
			const text = respond.mock.calls[0][0].text;
			expect(text).toContain("Model:");
			expect(text).toContain("Thinking Level:");
			expect(text).toContain("Messages:");
		});
	});

	// -- /new -------------------------------------------------------------

	describe("/new", () => {
		it("resets session state", async () => {
			// First increment message count
			const sessionKey = "slack-channel-C_NEW";
			incrementMessageCount(sessionKey);
			expect(getSessionState(sessionKey).messageCount).toBe(1);

			const { command, ack, respond } = makeCommand("C_NEW", "U_AUTH");
			await handlers.get("/new")!({ command, ack, respond });
			expect(ack).toHaveBeenCalled();
			expect(respond).toHaveBeenCalledWith(
				expect.objectContaining({
					response_type: "ephemeral",
					text: expect.stringContaining("Session Reset"),
				}),
			);

			// Session state should be fresh
			expect(getSessionState(sessionKey).messageCount).toBe(0);
		});
	});

	// -- /think -----------------------------------------------------------

	describe("/think", () => {
		it("shows current level when no argument given", async () => {
			const { command, ack, respond } = makeCommand("C1", "U_AUTH", "");
			await handlers.get("/think")!({ command, ack, respond });
			expect(respond).toHaveBeenCalledWith(
				expect.objectContaining({
					text: expect.stringContaining("Current thinking level"),
				}),
			);
		});

		it("sets valid thinking level", async () => {
			const { command, ack, respond } = makeCommand("C1", "U_AUTH", "high");
			await handlers.get("/think")!({ command, ack, respond });
			expect(respond).toHaveBeenCalledWith(
				expect.objectContaining({
					text: expect.stringContaining("high"),
				}),
			);
			const state = getSessionState("slack-channel-C1");
			expect(state.thinkingLevel).toBe("high");
		});

		it("rejects invalid thinking level", async () => {
			const { command, ack, respond } = makeCommand("C1", "U_AUTH", "turbo");
			await handlers.get("/think")!({ command, ack, respond });
			expect(respond).toHaveBeenCalledWith(
				expect.objectContaining({
					text: expect.stringContaining("Invalid thinking level"),
				}),
			);
		});

		it("accepts all valid levels", async () => {
			for (const level of ["off", "minimal", "low", "medium", "high", "xhigh"]) {
				const { command, ack, respond } = makeCommand(`C_THINK_${level}`, "U_AUTH", level);
				await handlers.get("/think")!({ command, ack, respond });
				expect(respond).toHaveBeenCalledWith(
					expect.objectContaining({
						text: expect.stringContaining(level),
					}),
				);
			}
		});
	});

	// -- /verbose ---------------------------------------------------------

	describe("/verbose", () => {
		it("toggles verbose mode when no argument", async () => {
			const sessionKey = "slack-channel-C_VERB";
			expect(getSessionState(sessionKey).verbose).toBe(false);

			const { command, ack, respond } = makeCommand("C_VERB", "U_AUTH", "");
			await handlers.get("/verbose")!({ command, ack, respond });
			expect(getSessionState(sessionKey).verbose).toBe(true);

			const call2 = makeCommand("C_VERB", "U_AUTH", "");
			await handlers.get("/verbose")!({ command: call2.command, ack: call2.ack, respond: call2.respond });
			expect(getSessionState(sessionKey).verbose).toBe(false);
		});

		it("enables verbose with 'on'", async () => {
			const { command, ack, respond } = makeCommand("C_VERB_ON", "U_AUTH", "on");
			await handlers.get("/verbose")!({ command, ack, respond });
			expect(respond).toHaveBeenCalledWith(
				expect.objectContaining({ text: expect.stringContaining("enabled") }),
			);
		});

		it("disables verbose with 'off'", async () => {
			// Turn on first
			const on = makeCommand("C_VERB_OFF", "U_AUTH", "on");
			await handlers.get("/verbose")!({ command: on.command, ack: on.ack, respond: on.respond });

			const { command, ack, respond } = makeCommand("C_VERB_OFF", "U_AUTH", "off");
			await handlers.get("/verbose")!({ command, ack, respond });
			expect(respond).toHaveBeenCalledWith(
				expect.objectContaining({ text: expect.stringContaining("disabled") }),
			);
		});
	});

	// -- /usage -----------------------------------------------------------

	describe("/usage", () => {
		it("shows current mode when no argument", async () => {
			const { command, ack, respond } = makeCommand("C1", "U_AUTH", "");
			await handlers.get("/usage")!({ command, ack, respond });
			expect(respond).toHaveBeenCalledWith(
				expect.objectContaining({
					text: expect.stringContaining("Current usage mode"),
				}),
			);
		});

		it("sets valid usage mode", async () => {
			const { command, ack, respond } = makeCommand("C_USAGE", "U_AUTH", "full");
			await handlers.get("/usage")!({ command, ack, respond });
			expect(respond).toHaveBeenCalledWith(
				expect.objectContaining({
					text: expect.stringContaining("full"),
				}),
			);
			expect(getSessionState("slack-channel-C_USAGE").usageMode).toBe("full");
		});

		it("rejects invalid usage mode", async () => {
			const { command, ack, respond } = makeCommand("C1", "U_AUTH", "verbose");
			await handlers.get("/usage")!({ command, ack, respond });
			expect(respond).toHaveBeenCalledWith(
				expect.objectContaining({
					text: expect.stringContaining("Invalid usage mode"),
				}),
			);
		});
	});

	// -- /model -----------------------------------------------------------

	describe("/model", () => {
		it("lists available models when no argument", async () => {
			const { command, ack, respond } = makeCommand("C1", "U_AUTH", "");
			await handlers.get("/model")!({ command, ack, respond });
			expect(respond).toHaveBeenCalledWith(
				expect.objectContaining({
					text: expect.stringContaining("Available models"),
				}),
			);
			const text = respond.mock.calls[0][0].text;
			expect(text).toContain("claude-sonnet-4-20250514");
			expect(text).toContain("gpt-4o");
		});

		it("switches to a model by exact ID", async () => {
			const { command, ack, respond } = makeCommand(
				"C_MODEL",
				"U_AUTH",
				"claude-opus-4-20250514",
			);
			await handlers.get("/model")!({ command, ack, respond });
			expect(respond).toHaveBeenCalledWith(
				expect.objectContaining({
					text: expect.stringContaining("Model switched to"),
				}),
			);
			expect(ctx.setSessionProvider).toHaveBeenCalledWith(
				"slack-channel-C_MODEL",
				"anthropic",
				{ model: "claude-opus-4-20250514" },
			);
		});

		it("switches to a model by partial match", async () => {
			const { command, ack, respond } = makeCommand("C_MODEL2", "U_AUTH", "haiku");
			await handlers.get("/model")!({ command, ack, respond });
			expect(respond).toHaveBeenCalledWith(
				expect.objectContaining({
					text: expect.stringContaining("Model switched to"),
				}),
			);
		});

		it("rejects unknown model name", async () => {
			const { command, ack, respond } = makeCommand("C1", "U_AUTH", "llama-99");
			await handlers.get("/model")!({ command, ack, respond });
			expect(respond).toHaveBeenCalledWith(
				expect.objectContaining({
					text: expect.stringContaining("Unknown model"),
				}),
			);
		});

		it("falls back to local state when setSessionProvider is unavailable", async () => {
			const ctxNoProvider = mockContext({ setSessionProvider: undefined });
			const mock = createMockBoltApp();
			registerSlashCommands(mock.app, () => ctxNoProvider);

			const { command, ack, respond } = makeCommand(
				"C_LOCAL",
				"U_AUTH",
				"claude-opus-4-20250514",
			);
			await mock.handlers.get("/model")!({ command, ack, respond });
			expect(respond).toHaveBeenCalledWith(
				expect.objectContaining({
					text: expect.stringContaining("Model switched to"),
				}),
			);
		});

		it("reports error when setSessionProvider throws", async () => {
			const ctxBroken = mockContext({
				setSessionProvider: vi.fn().mockRejectedValue(new Error("provider down")),
			});
			const mock = createMockBoltApp();
			registerSlashCommands(mock.app, () => ctxBroken);

			const { command, ack, respond } = makeCommand(
				"C_ERR",
				"U_AUTH",
				"claude-opus-4-20250514",
			);
			await mock.handlers.get("/model")!({ command, ack, respond });
			expect(respond).toHaveBeenCalledWith(
				expect.objectContaining({
					text: expect.stringContaining("Failed to switch model"),
				}),
			);
		});

		it("shows 'no models' message when no providers available", async () => {
			const ctxEmpty = mockContext({
				getProvider: vi.fn(() => undefined),
			});
			const mock = createMockBoltApp();
			registerSlashCommands(mock.app, () => ctxEmpty);

			const { command, ack, respond } = makeCommand("C1", "U_AUTH", "");
			await mock.handlers.get("/model")!({ command, ack, respond });
			expect(respond).toHaveBeenCalledWith(
				expect.objectContaining({
					text: expect.stringContaining("No models discovered"),
				}),
			);
		});
	});

	// -- /session ---------------------------------------------------------

	describe("/session", () => {
		it("shows usage when no argument given", async () => {
			const { command, ack, respond } = makeCommand("C1", "U_AUTH", "");
			await handlers.get("/session")!({ command, ack, respond });
			expect(respond).toHaveBeenCalledWith(
				expect.objectContaining({
					text: expect.stringContaining("Usage:"),
				}),
			);
		});

		it("switches to a named session", async () => {
			const { command, ack, respond } = makeCommand("C_SESS", "U_AUTH", "work");
			await handlers.get("/session")!({ command, ack, respond });
			expect(respond).toHaveBeenCalledWith(
				expect.objectContaining({
					text: expect.stringContaining("slack-channel-C_SESS/work"),
				}),
			);
			// Effective session key should reflect the override
			expect(getEffectiveSessionKey("C_SESS", "U_AUTH", false)).toBe(
				"slack-channel-C_SESS/work",
			);
		});

		it("resets to default session", async () => {
			// Set a named session first
			const set = makeCommand("C_SESS_DEF", "U_AUTH", "project-x");
			await handlers.get("/session")!({ command: set.command, ack: set.ack, respond: set.respond });

			const { command, ack, respond } = makeCommand("C_SESS_DEF", "U_AUTH", "default");
			await handlers.get("/session")!({ command, ack, respond });
			expect(respond).toHaveBeenCalledWith(
				expect.objectContaining({
					text: expect.stringContaining("default session"),
				}),
			);
			expect(getEffectiveSessionKey("C_SESS_DEF", "U_AUTH", false)).toBe(
				"slack-channel-C_SESS_DEF",
			);
		});

		it("uses DM session key for DM channels", async () => {
			const { command, ack, respond } = makeCommand("D_DM_SESS", "U_AUTH", "debug");
			await handlers.get("/session")!({ command, ack, respond });
			expect(respond).toHaveBeenCalledWith(
				expect.objectContaining({
					text: expect.stringContaining("slack-dm-U_AUTH/debug"),
				}),
			);
		});
	});

	// -- /cancel ----------------------------------------------------------

	describe("/cancel", () => {
		it("reports cancelled when cancelInject returns true", async () => {
			(ctx.cancelInject as any).mockReturnValue(true);
			const { command, ack, respond } = makeCommand("C1", "U_AUTH");
			await handlers.get("/cancel")!({ command, ack, respond });
			expect(respond).toHaveBeenCalledWith(
				expect.objectContaining({
					text: expect.stringContaining("Cancelled"),
				}),
			);
		});

		it("reports nothing to cancel when cancelInject returns false", async () => {
			(ctx.cancelInject as any).mockReturnValue(false);
			const { command, ack, respond } = makeCommand("C1", "U_AUTH");
			await handlers.get("/cancel")!({ command, ack, respond });
			expect(respond).toHaveBeenCalledWith(
				expect.objectContaining({
					text: expect.stringContaining("Nothing to cancel"),
				}),
			);
		});

		it("handles missing cancelInject gracefully", async () => {
			const ctxNoCancelInject = mockContext({ cancelInject: undefined });
			const mock = createMockBoltApp();
			registerSlashCommands(mock.app, () => ctxNoCancelInject);

			const { command, ack, respond } = makeCommand("C1", "U_AUTH");
			await mock.handlers.get("/cancel")!({ command, ack, respond });
			expect(respond).toHaveBeenCalledWith(
				expect.objectContaining({
					text: expect.stringContaining("Nothing to cancel"),
				}),
			);
		});
	});

	// -- /compact ---------------------------------------------------------

	describe("/compact", () => {
		it("triggers context compaction", async () => {
			const { command, ack, respond } = makeCommand("C_COMPACT", "U_AUTH");
			await handlers.get("/compact")!({ command, ack, respond });
			expect(ack).toHaveBeenCalled();
			expect(ctx.inject).toHaveBeenCalledWith(
				"slack-channel-C_COMPACT",
				"/compact",
				expect.objectContaining({ silent: true }),
			);
			// Two respond calls: initial "Compacting..." and final result
			expect(respond).toHaveBeenCalledTimes(2);
		});

		it("reports compaction failure", async () => {
			const ctxFail = mockContext({
				inject: vi.fn().mockRejectedValue(new Error("compact failed")),
			});
			const mock = createMockBoltApp();
			registerSlashCommands(mock.app, () => ctxFail);

			const { command, ack, respond } = makeCommand("C1", "U_AUTH");
			await mock.handlers.get("/compact")!({ command, ack, respond });
			expect(respond).toHaveBeenCalledWith(
				expect.objectContaining({
					text: expect.stringContaining("Failed to compact"),
				}),
			);
		});
	});

	// -- /help ------------------------------------------------------------

	describe("/help", () => {
		it("shows all commands in help text", async () => {
			const { command, ack, respond } = makeCommand("C1", "U_AUTH");
			await handlers.get("/help")!({ command, ack, respond });
			expect(ack).toHaveBeenCalled();
			const text = respond.mock.calls[0][0].text;
			expect(text).toContain("/status");
			expect(text).toContain("/new");
			expect(text).toContain("/compact");
			expect(text).toContain("/think");
			expect(text).toContain("/verbose");
			expect(text).toContain("/usage");
			expect(text).toContain("/model");
			expect(text).toContain("/cancel");
			expect(text).toContain("/session");
			expect(text).toContain("/help");
		});

		it("does not require auth", async () => {
			// Help should work even for unauthorized users -- it has no requireAuth call
			const { command, ack, respond } = makeCommand("C1", "U_UNAUTH");
			await handlers.get("/help")!({ command, ack, respond });
			expect(respond).toHaveBeenCalledWith(
				expect.objectContaining({
					response_type: "ephemeral",
					text: expect.stringContaining("WOPR Slack Commands"),
				}),
			);
		});

		it("responds ephemerally", async () => {
			const { command, ack, respond } = makeCommand("C1", "U_AUTH");
			await handlers.get("/help")!({ command, ack, respond });
			expect(respond).toHaveBeenCalledWith(
				expect.objectContaining({ response_type: "ephemeral" }),
			);
		});
	});
});

// ---------------------------------------------------------------------------
// Exported helper functions
// ---------------------------------------------------------------------------

describe("getSessionState", () => {
	it("returns default state for new session", () => {
		const state = getSessionState("test-fresh-session");
		expect(state.thinkingLevel).toBe("medium");
		expect(state.verbose).toBe(false);
		expect(state.usageMode).toBe("tokens");
		expect(state.messageCount).toBe(0);
		expect(state.model).toBe("claude-sonnet-4-20250514");
	});

	it("returns same state object on repeated calls", () => {
		const a = getSessionState("test-same");
		const b = getSessionState("test-same");
		expect(a).toBe(b);
	});
});

describe("resetSession", () => {
	it("clears session so next getSessionState returns defaults", () => {
		const state = getSessionState("test-reset");
		state.thinkingLevel = "high";
		state.messageCount = 42;
		resetSession("test-reset");
		const fresh = getSessionState("test-reset");
		expect(fresh.thinkingLevel).toBe("medium");
		expect(fresh.messageCount).toBe(0);
	});
});

describe("incrementMessageCount", () => {
	it("increments the message counter", () => {
		const key = "test-increment";
		incrementMessageCount(key);
		incrementMessageCount(key);
		expect(getSessionState(key).messageCount).toBe(2);
	});
});

describe("getEffectiveSessionKey", () => {
	it("returns DM key for DM channels", () => {
		expect(getEffectiveSessionKey("D_CHAN", "U_USER", true)).toBe(
			"slack-dm-U_USER",
		);
	});

	it("returns channel key for non-DM channels", () => {
		expect(getEffectiveSessionKey("C_CHAN", "U_USER", false)).toBe(
			"slack-channel-C_CHAN",
		);
	});
});
