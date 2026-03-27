import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockMessageCreate, mockClient, mockWSClient, mockEventDispatcher } =
	vi.hoisted(() => {
		const mockMessageCreate = vi.fn().mockResolvedValue({
			data: { message_id: "msg_test_123" },
		});
		const mockClient = {
			im: { message: { create: mockMessageCreate } },
		};
		const mockWSClient = { start: vi.fn(), close: vi.fn() };
		const mockEventDispatcher = { register: vi.fn().mockReturnThis() };
		return { mockMessageCreate, mockClient, mockWSClient, mockEventDispatcher };
	});

vi.mock("@larksuiteoapi/node-sdk", () => {
	const Domain = { Feishu: 0, Lark: 1 };
	const AppType = { SelfBuild: 0 };
	const LoggerLevel = { info: 3 };
	const mockCardHandler = {};

	return {
		Domain,
		AppType,
		LoggerLevel,
		// biome-ignore lint/suspicious/noExplicitAny: vitest mock constructor requires function keyword
		Client: vi.fn(function () { return mockClient; } as any),
		// biome-ignore lint/suspicious/noExplicitAny: vitest mock constructor requires function keyword
		WSClient: vi.fn(function () { return mockWSClient; } as any),
		// biome-ignore lint/suspicious/noExplicitAny: vitest mock constructor requires function keyword
		EventDispatcher: vi.fn(function () { return mockEventDispatcher; } as any),
		// biome-ignore lint/suspicious/noExplicitAny: vitest mock constructor requires function keyword
		CardActionHandler: vi.fn(function () { return mockCardHandler; } as any),
		adaptDefault: vi.fn(
			() => (_req: unknown, _res: unknown) => Promise.resolve(),
		),
	};
});

vi.mock("winston", () => {
	const mockLogger = {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	};
	const transports = { Console: vi.fn(), File: vi.fn() };
	const format = {
		combine: vi.fn(),
		timestamp: vi.fn(),
		simple: vi.fn(),
		json: vi.fn(),
	};
	return {
		default: {
			createLogger: vi.fn(() => mockLogger),
			transports,
			format,
		},
		createLogger: vi.fn(() => mockLogger),
		transports,
		format,
	};
});

vi.mock("node:http", () => {
	const mockServer = { listen: vi.fn(), close: vi.fn(), on: vi.fn() };
	return { default: { createServer: vi.fn(() => mockServer) } };
});

vi.mock("node:path", () => {
	return { default: { join: vi.fn((...args: string[]) => args.join("/")) } };
});

describe("sendNotification", () => {
	let plugin: typeof import("../../src/index.js").default;

	const mockCtx = {
		getConfig: vi.fn(() => ({
			appId: "cli_test",
			appSecret: "secret_test",
			mode: "websocket",
		})),
		registerConfigSchema: vi.fn(),
		unregisterConfigSchema: vi.fn(),
		registerChannelProvider: vi.fn(),
		unregisterChannelProvider: vi.fn(),
		getAgentIdentity: vi.fn().mockResolvedValue({ name: "TestBot" }),
		log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
		logMessage: vi.fn(),
		inject: vi.fn().mockResolvedValue("response"),
		injectPeer: vi.fn(),
		getIdentity: vi.fn(),
		getUserProfile: vi.fn(),
		getSessions: vi.fn(() => []),
		getPeers: vi.fn(() => []),
		saveConfig: vi.fn(),
		getMainConfig: vi.fn(),
		getPluginDir: vi.fn(() => "/tmp/test"),
		storage: { register: vi.fn(), getRepository: vi.fn() },
		events: { on: vi.fn(), once: vi.fn(), emitCustom: vi.fn() },
		hooks: { on: vi.fn(), off: vi.fn() },
	};

	beforeEach(async () => {
		vi.clearAllMocks();
		vi.resetModules();
		const mod = await import("../../src/index.js");
		plugin = mod.default;
		await plugin.init!(mockCtx as never);
	});

	it("channel provider has sendNotification method", () => {
		const provider = mockCtx.registerChannelProvider.mock.calls[0][0];
		expect(provider.sendNotification).toBeTypeOf("function");
	});

	it("sends interactive card for friend-request notification", async () => {
		const provider = mockCtx.registerChannelProvider.mock.calls[0][0];
		const onAccept = vi.fn().mockResolvedValue(undefined);
		const onDeny = vi.fn().mockResolvedValue(undefined);

		await provider.sendNotification(
			"oc_test_chat",
			{
				type: "friend-request",
				from: "alice",
				pubkey: "abc123",
				channelName: "test-channel",
			},
			{ onAccept, onDeny },
		);

		expect(mockMessageCreate).toHaveBeenCalledOnce();
		const callArgs = mockMessageCreate.mock.calls[0][0];
		expect(callArgs.params.receive_id_type).toBe("chat_id");
		expect(callArgs.data.receive_id).toBe("oc_test_chat");
		expect(callArgs.data.msg_type).toBe("interactive");

		const content = JSON.parse(callArgs.data.content);
		const actions = content.elements.find(
			(el: { tag: string }) => el.tag === "action",
		);
		expect(actions).toBeDefined();
		expect(actions.actions).toHaveLength(2);
		expect(actions.actions[0].text.content).toBe("Accept");
		expect(actions.actions[1].text.content).toBe("Deny");
	});

	it("silently returns for non-friend-request types", async () => {
		const provider = mockCtx.registerChannelProvider.mock.calls[0][0];

		await provider.sendNotification(
			"oc_test",
			{ type: "unknown-type" },
			{},
		);

		expect(mockMessageCreate).not.toHaveBeenCalled();
	});

	it("silently returns when client is null (no credentials)", async () => {
		await plugin.shutdown!();
		mockCtx.getConfig.mockReturnValue({});
		vi.resetModules();

		const mod = await import("../../src/index.js");
		await mod.default.init!(mockCtx as never);
		const provider = mockCtx.registerChannelProvider.mock.calls[0][0];

		await provider.sendNotification(
			"oc_test",
			{ type: "friend-request", from: "bob" },
			{ onAccept: vi.fn() },
		);

		expect(mockMessageCreate).not.toHaveBeenCalled();
	});
});

describe("handleCardAction with pending callbacks", () => {
	it("fires onAccept callback when accept button is clicked", async () => {
		vi.resetModules();
		const { handleCardAction, storePendingCallbacks, removePendingCallbacks } =
			await import("../../src/index.js");

		const onAccept = vi.fn().mockResolvedValue(undefined);
		const onDeny = vi.fn().mockResolvedValue(undefined);

		storePendingCallbacks("req_alice", { onAccept, onDeny, timestamp: Date.now() });

		await handleCardAction({
			action: { tag: "button", value: { key: "req_alice", action: "accept" } },
		});

		expect(onAccept).toHaveBeenCalledOnce();
		expect(onDeny).not.toHaveBeenCalled();

		expect(removePendingCallbacks("req_alice")).toBeUndefined();
	});

	it("fires onDeny callback when deny button is clicked", async () => {
		vi.resetModules();
		const { handleCardAction, storePendingCallbacks } =
			await import("../../src/index.js");

		const onAccept = vi.fn().mockResolvedValue(undefined);
		const onDeny = vi.fn().mockResolvedValue(undefined);

		storePendingCallbacks("req_bob", { onAccept, onDeny, timestamp: Date.now() });

		await handleCardAction({
			action: { tag: "button", value: { key: "req_bob", action: "deny" } },
		});

		expect(onDeny).toHaveBeenCalledOnce();
		expect(onAccept).not.toHaveBeenCalled();
	});

	it("ignores card actions with no matching pending callbacks", async () => {
		vi.resetModules();
		const { handleCardAction } = await import("../../src/index.js");

		const result = await handleCardAction({
			action: { tag: "button", value: { key: "nonexistent", action: "accept" } },
		});
		expect(result).toBeUndefined();
	});
});

describe("cleanupExpiredNotifications", () => {
	it("removes entries older than TTL", async () => {
		vi.resetModules();
		const { storePendingCallbacks, cleanupExpiredNotifications, getPendingCallbacks } =
			await import("../../src/index.js");

		storePendingCallbacks("old_req", {
			onAccept: vi.fn(),
			timestamp: Date.now() - 16 * 60 * 1000,
		});
		storePendingCallbacks("new_req", {
			onAccept: vi.fn(),
			timestamp: Date.now(),
		});

		cleanupExpiredNotifications();

		expect(getPendingCallbacks("old_req")).toBeUndefined();
		expect(getPendingCallbacks("new_req")).toBeDefined();
	});
});
