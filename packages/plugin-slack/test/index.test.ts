import { describe, it, expect, vi, beforeEach } from "vitest";

// Shared mock state
const mockStart = vi.fn();
const mockStop = vi.fn();
const mockMessage = vi.fn();
const mockEvent = vi.fn();
const mockCommand = vi.fn();
const mockAction = vi.fn();
const mockAuthTest = vi.fn().mockResolvedValue({ user_id: "UBOT123" });
const mockReactionsAdd = vi.fn();
const mockReactionsRemove = vi.fn();
const mockChatUpdate = vi.fn();
const mockChatPostMessage = vi.fn();

// Track constructor calls
let appConstructorCalls: any[] = [];

vi.mock("@slack/bolt", () => {
	// Use a real class so `new App(...)` works
	class MockApp {
		start = mockStart;
		stop = mockStop;
		message = mockMessage;
		event = mockEvent;
		command = mockCommand;
		action = mockAction;
		client = {
			auth: { test: mockAuthTest },
			reactions: { add: mockReactionsAdd, remove: mockReactionsRemove },
			chat: { update: mockChatUpdate, postMessage: mockChatPostMessage },
		};
		constructor(opts: any) {
			appConstructorCalls.push(opts);
		}
	}
	return {
		App: MockApp,
		FileInstallationStore: vi.fn(),
		LogLevel: { INFO: "info", DEBUG: "debug" },
	};
});

vi.mock("winston", () => {
	const mockLogger = {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
	};
	return {
		default: {
			createLogger: vi.fn(() => mockLogger),
			format: {
				combine: vi.fn(),
				timestamp: vi.fn(),
				errors: vi.fn(),
				json: vi.fn(),
				colorize: vi.fn(),
				simple: vi.fn(),
			},
			transports: {
				File: vi.fn(),
				Console: vi.fn(),
			},
		},
	};
});

import type { WOPRPluginContext } from "../src/types.js";

function mockContext(
	configOverride: Record<string, any> = {},
): WOPRPluginContext {
	let storedConfig = structuredClone(configOverride);
	return {
		inject: vi.fn().mockResolvedValue("response text"),
		logMessage: vi.fn(),
		injectPeer: vi.fn(),
		getIdentity: () => ({ publicKey: "pk", shortId: "id", encryptPub: "ep" }),
		getAgentIdentity: vi.fn().mockResolvedValue({ name: "WOPR", emoji: "👀" }),
		getUserProfile: () => ({}),
		getSessions: () => [],
		getPeers: () => [],
		getConfig: () => storedConfig as any,
		saveConfig: vi.fn(async (c: any) => {
			storedConfig = c;
		}),
		getMainConfig: () => ({}),
		registerConfigSchema: vi.fn(),
		unregisterConfigSchema: vi.fn(),
		registerChannelProvider: vi.fn(),
		unregisterChannelProvider: vi.fn(),
		registerExtension: vi.fn(),
		unregisterExtension: vi.fn(),
		getExtension: vi.fn(),
		listExtensions: vi.fn().mockReturnValue([]),
		cancelInject: vi.fn().mockReturnValue(false),
		events: {
			on: vi.fn().mockReturnValue(() => {}),
			once: vi.fn(),
			off: vi.fn(),
			emit: vi.fn().mockResolvedValue(undefined),
			emitCustom: vi.fn().mockResolvedValue(undefined),
			listenerCount: vi.fn().mockReturnValue(0),
		},
		hooks: {
			on: vi.fn().mockReturnValue(() => {}),
			off: vi.fn(),
			offByName: vi.fn(),
			list: vi.fn().mockReturnValue([]),
		},
		registerContextProvider: vi.fn(),
		unregisterContextProvider: vi.fn(),
		getContextProvider: vi.fn(),
		registerChannel: vi.fn(),
		unregisterChannel: vi.fn(),
		getChannel: vi.fn(),
		getChannels: vi.fn().mockReturnValue([]),
		getChannelsForSession: vi.fn().mockReturnValue([]),
		registerWebUiExtension: vi.fn(),
		unregisterWebUiExtension: vi.fn(),
		getWebUiExtensions: vi.fn().mockReturnValue([]),
		registerUiComponent: vi.fn(),
		unregisterUiComponent: vi.fn(),
		getUiComponents: vi.fn().mockReturnValue([]),
		registerProvider: vi.fn(),
		unregisterProvider: vi.fn(),
		getProvider: vi.fn(),
		registerSTTProvider: vi.fn(),
		registerTTSProvider: vi.fn(),
		getSTT: vi.fn(),
		getTTS: vi.fn(),
		hasVoice: vi.fn().mockReturnValue({ stt: false, tts: false }),
		getChannelProvider: vi.fn(),
		getChannelProviders: vi.fn().mockReturnValue([]),
		getConfigSchema: vi.fn(),
		getPluginDir: () => "/tmp",
		log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
	} as unknown as WOPRPluginContext;
}

describe("plugin default export", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		appConstructorCalls = [];
		mockAction.mockReset();
	});

	it("exports a valid WOPRPlugin shape", async () => {
		const { default: plugin } = await import("../src/index.js");
		expect(plugin.name).toBe("wopr-plugin-slack");
		expect(plugin.version).toBe("1.0.0");
		expect(plugin.description).toBeDefined();
		expect(typeof plugin.init).toBe("function");
		expect(typeof plugin.shutdown).toBe("function");
	});

	describe("init", () => {
		it("registers config schema", async () => {
			const { default: plugin } = await import("../src/index.js");
			const ctx = mockContext({});
			await plugin.init!(ctx);
			expect(ctx.registerConfigSchema).toHaveBeenCalledWith(
				"wopr-plugin-slack",
				expect.objectContaining({
					title: "Slack Integration",
					fields: expect.any(Array),
				}),
			);
		});

		it("returns early when enabled is falsy", async () => {
			const { default: plugin } = await import("../src/index.js");
			const ctx = mockContext({});
			await plugin.init!(ctx);
			// App constructor should not be called because enabled is falsy
			expect(appConstructorCalls).toHaveLength(0);
		});

		it("returns early when botToken is missing", async () => {
			const { default: plugin } = await import("../src/index.js");
			const ctx = mockContext({
				channels: { slack: { enabled: true } },
			});
			await plugin.init!(ctx);
			expect(appConstructorCalls).toHaveLength(0);
		});

		it("initializes Slack app in socket mode with valid config", async () => {
			const { default: plugin } = await import("../src/index.js");
			const ctx = mockContext({
				channels: {
					slack: {
						enabled: true,
						botToken: "xoxb-test",
						appToken: "xapp-test",
						mode: "socket",
					},
				},
			});

			await plugin.init!(ctx);
			expect(appConstructorCalls).toHaveLength(1);
			expect(appConstructorCalls[0]).toMatchObject({
				token: "xoxb-test",
				appToken: "xapp-test",
				socketMode: true,
			});
			expect(mockStart).toHaveBeenCalled();
			expect(mockMessage).toHaveBeenCalled();
		});

		it("initializes Slack app in HTTP mode with valid config", async () => {
			const { default: plugin } = await import("../src/index.js");
			const ctx = mockContext({
				channels: {
					slack: {
						enabled: true,
						botToken: "xoxb-test",
						signingSecret: "secret123",
						mode: "http",
					},
				},
			});

			await plugin.init!(ctx);
			expect(appConstructorCalls).toHaveLength(1);
			expect(appConstructorCalls[0]).toMatchObject({
				token: "xoxb-test",
				signingSecret: "secret123",
			});
		});

		it("throws when socket mode missing appToken", async () => {
			const { default: plugin } = await import("../src/index.js");
			const ctx = mockContext({
				channels: {
					slack: {
						enabled: true,
						botToken: "xoxb-test",
						mode: "socket",
					},
				},
			});

			await expect(plugin.init!(ctx)).rejects.toThrow(
				"App Token required for Socket Mode",
			);
		});

		it("throws when HTTP mode missing signingSecret", async () => {
			const { default: plugin } = await import("../src/index.js");
			const ctx = mockContext({
				channels: {
					slack: {
						enabled: true,
						botToken: "xoxb-test",
						mode: "http",
					},
				},
			});

			await expect(plugin.init!(ctx)).rejects.toThrow(
				"Signing Secret required for HTTP mode",
			);
		});

		it("registers message and app_mention event handlers", async () => {
			const { default: plugin } = await import("../src/index.js");
			const ctx = mockContext({
				channels: {
					slack: {
						enabled: true,
						botToken: "xoxb-test",
						appToken: "xapp-test",
						mode: "socket",
					},
				},
			});

			await plugin.init!(ctx);
			expect(mockMessage).toHaveBeenCalled();
			expect(mockEvent).toHaveBeenCalledWith(
				"app_mention",
				expect.any(Function),
			);
		});

		it("refreshes agent identity on init", async () => {
			const { default: plugin } = await import("../src/index.js");
			const ctx = mockContext({});
			await plugin.init!(ctx);
			expect(ctx.getAgentIdentity).toHaveBeenCalled();
		});

		it("reads botToken from env when not in config", async () => {
			const { default: plugin } = await import("../src/index.js");

			const originalBot = process.env.SLACK_BOT_TOKEN;
			const originalApp = process.env.SLACK_APP_TOKEN;
			process.env.SLACK_BOT_TOKEN = "xoxb-from-env";
			process.env.SLACK_APP_TOKEN = "xapp-from-env";

			try {
				const ctx = mockContext({
					channels: { slack: { enabled: true, mode: "socket" } },
				});
				await plugin.init!(ctx);
				expect(appConstructorCalls).toHaveLength(1);
				expect(appConstructorCalls[0]).toMatchObject({
					token: "xoxb-from-env",
					appToken: "xapp-from-env",
				});
			} finally {
				if (originalBot) process.env.SLACK_BOT_TOKEN = originalBot;
				else delete process.env.SLACK_BOT_TOKEN;
				if (originalApp) process.env.SLACK_APP_TOKEN = originalApp;
				else delete process.env.SLACK_APP_TOKEN;
			}
		});
	});

	describe("shutdown", () => {
		it("calls app.stop() when app is initialized", async () => {
			const { default: plugin } = await import("../src/index.js");
			const ctx = mockContext({
				channels: {
					slack: {
						enabled: true,
						botToken: "xoxb-test",
						appToken: "xapp-test",
						mode: "socket",
					},
				},
			});

			await plugin.init!(ctx);
			await plugin.shutdown!();
			expect(mockStop).toHaveBeenCalled();
		});
	});

	describe("message handler behavior", () => {
		async function initPluginWithConfig(config: Record<string, any>) {
			const { default: plugin } = await import("../src/index.js");
			const ctx = mockContext({
				channels: {
					slack: {
						enabled: true,
						botToken: "xoxb-test",
						appToken: "xapp-test",
						mode: "socket",
						...config,
					},
				},
			});

			await plugin.init!(ctx);
			const messageHandler = mockMessage.mock.calls[0]?.[0];
			return { plugin, ctx, messageHandler };
		}

		it("skips messages without text", async () => {
			const { ctx, messageHandler } = await initPluginWithConfig({});
			const say = vi.fn().mockResolvedValue({ ts: "1234" });

			await messageHandler({
				message: { user: "U123" },
				context: { channel: "C123" },
				say,
			});

			expect(ctx.inject).not.toHaveBeenCalled();
		});

		it("processes channel message when channel is in allowlist", async () => {
			const { ctx, messageHandler } = await initPluginWithConfig({
				groupPolicy: "allowlist",
				channels: { C_ALLOWED: { allow: true, enabled: true } },
			});
			const say = vi.fn().mockResolvedValue({ ts: "msg_ts_1" });

			await messageHandler({
				message: { text: "hello", user: "U123", ts: "orig_ts" },
				context: { channel: "C_ALLOWED", botUserId: "UBOT123" },
				say,
			});

			expect(ctx.inject).toHaveBeenCalledWith(
				"slack-channel-C_ALLOWED",
				"hello",
				expect.objectContaining({
					from: "U123",
					channel: { type: "slack", id: "C_ALLOWED" },
				}),
			);
		});

		it("ignores bot messages", async () => {
			const { ctx, messageHandler } = await initPluginWithConfig({
				groupPolicy: "allowlist",
				channels: { C_BOT: { allow: true, enabled: true } },
			});
			const say = vi.fn().mockResolvedValue({ ts: "msg_ts" });

			await messageHandler({
				message: {
					text: "hello",
					user: "U123",
					ts: "t1",
					subtype: "bot_message",
				},
				context: { channel: "C_BOT", botUserId: "UBOT123" },
				say,
			});

			expect(ctx.inject).not.toHaveBeenCalled();
		});

		it("ignores message_changed subtypes", async () => {
			const { ctx, messageHandler } = await initPluginWithConfig({
				groupPolicy: "allowlist",
				channels: { C_EDIT: { allow: true, enabled: true } },
			});
			const say = vi.fn().mockResolvedValue({ ts: "msg_ts" });

			await messageHandler({
				message: {
					text: "edited",
					user: "U123",
					ts: "t1",
					subtype: "message_changed",
				},
				context: { channel: "C_EDIT", botUserId: "UBOT123" },
				say,
			});

			expect(ctx.inject).not.toHaveBeenCalled();
		});

		it("ignores channels not in allowlist", async () => {
			const { ctx, messageHandler } = await initPluginWithConfig({
				groupPolicy: "allowlist",
				channels: {},
			});
			const say = vi.fn().mockResolvedValue({ ts: "msg_ts" });

			await messageHandler({
				message: { text: "hello", user: "U123", ts: "t1" },
				context: { channel: "C_NOT_ALLOWED", botUserId: "UBOT123" },
				say,
			});

			expect(ctx.inject).not.toHaveBeenCalled();
		});

		it("responds to DMs in open policy mode", async () => {
			const { ctx, messageHandler } = await initPluginWithConfig({
				dm: { enabled: true, policy: "open" },
			});
			const say = vi.fn().mockResolvedValue({ ts: "msg_ts_dm" });

			await messageHandler({
				message: { text: "hi bot", user: "U_DM_1", ts: "t_dm" },
				context: { channel: "D_OPEN_DM", botUserId: "UBOT123" },
				say,
			});

			expect(ctx.inject).toHaveBeenCalledWith(
				"slack-dm-U_DM_1",
				"hi bot",
				expect.objectContaining({ from: "U_DM_1" }),
			);
		});

		it("ignores DMs in closed policy mode", async () => {
			const { ctx, messageHandler } = await initPluginWithConfig({
				dm: { enabled: true, policy: "closed" },
			});
			const say = vi.fn().mockResolvedValue({ ts: "msg_ts" });

			await messageHandler({
				message: { text: "hi bot", user: "U_DM_2", ts: "t_dm2" },
				context: { channel: "D_CLOSED_DM", botUserId: "UBOT123" },
				say,
			});

			expect(ctx.inject).not.toHaveBeenCalled();
		});

		it("uses channel session key for channel messages", async () => {
			const { ctx, messageHandler } = await initPluginWithConfig({
				groupPolicy: "allowlist",
				channels: { C_SESS: { allow: true, enabled: true } },
			});
			const say = vi.fn().mockResolvedValue({ ts: "sess_ts" });

			await messageHandler({
				message: { text: "test session", user: "U_SESS_1", ts: "t_sess" },
				context: { channel: "C_SESS", botUserId: "UBOT123" },
				say,
			});

			expect(ctx.inject).toHaveBeenCalledWith(
				"slack-channel-C_SESS",
				"test session",
				expect.any(Object),
			);
		});

		it("responds in open group policy when mentioned", async () => {
			const { ctx, messageHandler } = await initPluginWithConfig({
				groupPolicy: "open",
			});
			const say = vi.fn().mockResolvedValue({ ts: "open_ts" });

			await messageHandler({
				message: {
					text: "hey <@UBOT123> what's up",
					user: "U_OPEN_1",
					ts: "t_open",
				},
				context: { channel: "C_OPEN", botUserId: "UBOT123" },
				say,
			});

			expect(ctx.inject).toHaveBeenCalled();
		});

		it("does not respond in open group policy without mention", async () => {
			const { ctx, messageHandler } = await initPluginWithConfig({
				groupPolicy: "open",
			});
			const say = vi.fn().mockResolvedValue({ ts: "nomention_ts" });

			await messageHandler({
				message: {
					text: "hello everyone",
					user: "U_OPEN_2",
					ts: "t_nomention",
				},
				context: { channel: "C_OPEN2", botUserId: "UBOT123" },
				say,
			});

			expect(ctx.inject).not.toHaveBeenCalled();
		});

		it("does not respond when groupPolicy is disabled", async () => {
			const { ctx, messageHandler } = await initPluginWithConfig({
				groupPolicy: "disabled",
			});
			const say = vi.fn().mockResolvedValue({ ts: "dis_ts" });

			await messageHandler({
				message: {
					text: "<@UBOT123> hello",
					user: "U_DIS_1",
					ts: "t_dis",
				},
				context: { channel: "C_DISABLED", botUserId: "UBOT123" },
				say,
			});

			expect(ctx.inject).not.toHaveBeenCalled();
		});

		it("requires mention when channel config says requireMention", async () => {
			const { ctx, messageHandler } = await initPluginWithConfig({
				groupPolicy: "allowlist",
				channels: {
					C_MENTION: { allow: true, enabled: true, requireMention: true },
				},
			});
			const say = vi.fn().mockResolvedValue({ ts: "m_ts" });

			// Without mention - should not respond
			await messageHandler({
				message: { text: "hello", user: "U_MEN_1", ts: "t_men_1" },
				context: { channel: "C_MENTION", botUserId: "UBOT123" },
				say,
			});
			expect(ctx.inject).not.toHaveBeenCalled();

			// With mention - should respond
			await messageHandler({
				message: {
					text: "hey <@UBOT123>",
					user: "U_MEN_1",
					ts: "t_men_2",
				},
				context: { channel: "C_MENTION", botUserId: "UBOT123" },
				say,
			});
			expect(ctx.inject).toHaveBeenCalled();
		});

		it("handles inject error gracefully", async () => {
			const { ctx, messageHandler } = await initPluginWithConfig({
				groupPolicy: "allowlist",
				channels: { C_ERR: { allow: true, enabled: true } },
			});
			(ctx.inject as any).mockRejectedValue(new Error("inject failed"));
			const say = vi.fn().mockResolvedValue({ ts: "err_ts" });

			// Should not throw
			await messageHandler({
				message: { text: "cause error", user: "U_ERR_1", ts: "t_err" },
				context: { channel: "C_ERR", botUserId: "UBOT123" },
				say,
			});

			// Should update message with error text
			expect(mockChatUpdate).toHaveBeenCalledWith(
				expect.objectContaining({
					text: expect.stringContaining("Error"),
				}),
			);
		});

		it("ignores DMs when dm.enabled is false", async () => {
			const { ctx, messageHandler } = await initPluginWithConfig({
				dm: { enabled: false },
			});
			const say = vi.fn().mockResolvedValue({ ts: "dm_off_ts" });

			await messageHandler({
				message: { text: "hi", user: "U_DM_OFF", ts: "t_off" },
				context: { channel: "D_OFF", botUserId: "UBOT123" },
				say,
			});

			expect(ctx.inject).not.toHaveBeenCalled();
		});

		it("logs message to session even when not responding", async () => {
			const { ctx, messageHandler } = await initPluginWithConfig({
				groupPolicy: "allowlist",
				channels: {},
			});
			const say = vi.fn().mockResolvedValue({ ts: "log_ts" });

			await messageHandler({
				message: { text: "just passing by", user: "U_LOG_1", ts: "t_log" },
				context: { channel: "C_NOLOG", botUserId: "UBOT123" },
				say,
			});

			expect(ctx.inject).not.toHaveBeenCalled();
			expect(ctx.logMessage).toHaveBeenCalledWith(
				"slack-channel-C_NOLOG",
				"just passing by",
				expect.objectContaining({ from: "U_LOG_1" }),
			);
		});
	});

	describe("sendNotification", () => {
		async function initPlugin() {
			const { default: plugin } = await import("../src/index.js");
			const ctx = mockContext({
				channels: {
					slack: {
						enabled: true,
						botToken: "xoxb-test",
						appToken: "xapp-test",
						mode: "socket",
					},
				},
			});
			await plugin.init!(ctx);
			return { plugin, ctx };
		}

		it("registers action handlers for notification_accept and notification_deny", async () => {
			await initPlugin();
			expect(mockAction).toHaveBeenCalledWith("notification_accept", expect.any(Function));
			expect(mockAction).toHaveBeenCalledWith("notification_deny", expect.any(Function));
		});

		it("posts friend request with Accept/Deny buttons when callbacks provided", async () => {
			mockChatPostMessage.mockResolvedValue({ ts: "notif_ts" });

			// Access slackChannelProvider via the registered channel provider
			const { default: plugin } = await import("../src/index.js");
			const ctx = mockContext({
				channels: {
					slack: {
						enabled: true,
						botToken: "xoxb-test",
						appToken: "xapp-test",
						mode: "socket",
					},
				},
			});
			const registeredProvider = { sendNotification: vi.fn() };
			ctx.registerChannelProvider = vi.fn((p: any) => {
				Object.assign(registeredProvider, p);
			});
			await plugin.init!(ctx);

			const onAccept = vi.fn();
			const onDeny = vi.fn();
			await registeredProvider.sendNotification(
				"C_NOTIF",
				{ type: "friend-request", from: "alice" },
				{ onAccept, onDeny },
			);

			expect(mockChatPostMessage).toHaveBeenCalledWith(
				expect.objectContaining({
					channel: "C_NOTIF",
					text: expect.stringContaining("alice"),
					blocks: expect.arrayContaining([
						expect.objectContaining({ type: "actions" }),
					]),
				}),
			);
		});

		it("posts friend request without buttons when no callbacks provided", async () => {
			mockChatPostMessage.mockResolvedValue({ ts: "notif_ts2" });

			const { default: plugin } = await import("../src/index.js");
			const ctx = mockContext({
				channels: {
					slack: {
						enabled: true,
						botToken: "xoxb-test",
						appToken: "xapp-test",
						mode: "socket",
					},
				},
			});
			const registeredProvider = { sendNotification: vi.fn() };
			ctx.registerChannelProvider = vi.fn((p: any) => {
				Object.assign(registeredProvider, p);
			});
			await plugin.init!(ctx);

			await registeredProvider.sendNotification("C_NOTIF2", {
				type: "friend-request",
				from: "bob",
			});

			expect(mockChatPostMessage).toHaveBeenCalledWith(
				expect.objectContaining({
					channel: "C_NOTIF2",
					text: expect.stringContaining("bob"),
				}),
			);
			// No actions block when no callbacks
			const call = mockChatPostMessage.mock.calls[0]?.[0];
			const blocks = call?.blocks ?? [];
			expect(blocks.every((b: any) => b.type !== "actions")).toBe(true);
		});

		it("ignores non-friend-request notification types", async () => {
			const { default: plugin } = await import("../src/index.js");
			const ctx = mockContext({
				channels: {
					slack: {
						enabled: true,
						botToken: "xoxb-test",
						appToken: "xapp-test",
						mode: "socket",
					},
				},
			});
			const registeredProvider = { sendNotification: vi.fn() };
			ctx.registerChannelProvider = vi.fn((p: any) => {
				Object.assign(registeredProvider, p);
			});
			await plugin.init!(ctx);

			await registeredProvider.sendNotification("C_NOTIF3", { type: "other-type" });
			expect(mockChatPostMessage).not.toHaveBeenCalled();
		});
	});
});
