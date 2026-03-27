import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockContext } from "./mocks/wopr-context.js";

// Mock the client module
const mockSignalRpcRequest = vi.fn().mockResolvedValue(undefined);
vi.mock("../src/client.js", () => ({
	signalRpcRequest: (...args: any[]) => mockSignalRpcRequest(...args),
	signalCheck: vi
		.fn()
		.mockResolvedValue({ ok: false, status: null, error: "mocked" }),
	streamSignalEvents: vi.fn().mockResolvedValue(undefined),
}));

// Mock the daemon module
vi.mock("../src/daemon.js", () => ({
	spawnSignalDaemon: vi.fn().mockReturnValue({ pid: 12345, stop: vi.fn() }),
	waitForSignalDaemonReady: vi.fn().mockResolvedValue(undefined),
}));

// Mock winston
vi.mock("winston", () => {
	const mockLogger = {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
	};
	return {
		default: {
			createLogger: vi.fn().mockReturnValue(mockLogger),
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

describe("sendNotification", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("throws for unsupported notification type", async () => {
		const { sendNotification } = await import("../src/index.js");

		await expect(
			sendNotification(
				"chan-1",
				{ type: "unknown-type" },
				{},
			),
		).rejects.toThrow("Unsupported notification type: unknown-type");
	});

	it("throws when no account is configured", async () => {
		const { default: plugin, sendNotification } = await import(
			"../src/index.js"
		);
		const mockCtx = createMockContext({
			getConfig: vi.fn().mockReturnValue({}),
		});
		await plugin.init(mockCtx);

		await expect(
			sendNotification(
				"chan-1",
				{ type: "friend-request", from: "Alice" },
				{},
			),
		).rejects.toThrow("no Signal account");

		await plugin.shutdown();
	});

	it("sends DM to owner and registers parser on friend-request", async () => {
		const { default: plugin, sendNotification, signalChannelProvider } =
			await import("../src/index.js");

		const mockCtx = createMockContext({
			getConfig: vi.fn().mockReturnValue({ account: "+15551234567" }),
		});
		await plugin.init(mockCtx);

		const onAccept = vi.fn().mockResolvedValue(undefined);
		const onDeny = vi.fn().mockResolvedValue(undefined);

		await sendNotification(
			"chan-1",
			{ type: "friend-request", from: "Bob" },
			{ onAccept, onDeny },
		);

		// Should have sent a DM to owner
		expect(mockSignalRpcRequest).toHaveBeenCalledWith(
			"send",
			expect.objectContaining({
				message: expect.stringContaining("Friend request from Bob"),
				recipient: ["+15551234567"],
			}),
			expect.any(Object),
		);

		// Should have registered a parser
		const parsers = signalChannelProvider.getMessageParsers();
		expect(parsers.length).toBeGreaterThanOrEqual(1);
		const notifParser = parsers.find((p) => p.id.startsWith("notif-"));
		expect(notifParser).toBeDefined();

		await plugin.shutdown();
	});

	it("parser calls onAccept when owner replies ACCEPT", async () => {
		const { default: plugin, sendNotification, signalChannelProvider } =
			await import("../src/index.js");

		const mockCtx = createMockContext({
			getConfig: vi.fn().mockReturnValue({ account: "+15551234567" }),
		});
		await plugin.init(mockCtx);

		const onAccept = vi.fn().mockResolvedValue(undefined);
		const onDeny = vi.fn().mockResolvedValue(undefined);

		await sendNotification(
			"chan-1",
			{ type: "friend-request", from: "Charlie" },
			{ onAccept, onDeny },
		);

		// Extract the notifId from the sent message
		const sentMsg = mockSignalRpcRequest.mock.calls[0][1].message as string;
		const match = sentMsg.match(/ACCEPT (\w+)/);
		expect(match).toBeTruthy();
		const notifId = match![1];

		// Find the parser
		const parsers = signalChannelProvider.getMessageParsers();
		const notifParser = parsers.find((p) => p.id.startsWith("notif-"));
		expect(notifParser).toBeDefined();

		// Simulate owner replying ACCEPT
		const replyFn = vi.fn().mockResolvedValue(undefined);
		await notifParser!.handler({
			channel: "+15551234567",
			channelType: "signal",
			sender: "+15551234567",
			content: `ACCEPT ${notifId}`,
			reply: replyFn,
			getBotUsername: () => "+15551234567",
		});

		expect(onAccept).toHaveBeenCalled();
		expect(onDeny).not.toHaveBeenCalled();
		expect(replyFn).toHaveBeenCalledWith("Accepted.");

		await plugin.shutdown();
	});

	it("parser calls onDeny when owner replies DENY", async () => {
		const { default: plugin, sendNotification, signalChannelProvider } =
			await import("../src/index.js");

		const mockCtx = createMockContext({
			getConfig: vi.fn().mockReturnValue({ account: "+15551234567" }),
		});
		await plugin.init(mockCtx);

		const onAccept = vi.fn().mockResolvedValue(undefined);
		const onDeny = vi.fn().mockResolvedValue(undefined);

		await sendNotification(
			"chan-1",
			{ type: "friend-request", from: "Dave" },
			{ onAccept, onDeny },
		);

		const sentMsg = mockSignalRpcRequest.mock.calls[0][1].message as string;
		const match = sentMsg.match(/DENY (\w+)/);
		const notifId = match![1];

		const parsers = signalChannelProvider.getMessageParsers();
		const notifParser = parsers.find((p) => p.id.startsWith("notif-"));

		const replyFn = vi.fn().mockResolvedValue(undefined);
		await notifParser!.handler({
			channel: "+15551234567",
			channelType: "signal",
			sender: "+15551234567",
			content: `DENY ${notifId}`,
			reply: replyFn,
			getBotUsername: () => "+15551234567",
		});

		expect(onDeny).toHaveBeenCalled();
		expect(onAccept).not.toHaveBeenCalled();
		expect(replyFn).toHaveBeenCalledWith("Denied.");

		await plugin.shutdown();
	});

	it("ignores responses from non-owner senders", async () => {
		const { default: plugin, sendNotification, signalChannelProvider } =
			await import("../src/index.js");

		const mockCtx = createMockContext({
			getConfig: vi.fn().mockReturnValue({ account: "+15551234567" }),
		});
		await plugin.init(mockCtx);

		const onAccept = vi.fn().mockResolvedValue(undefined);

		await sendNotification(
			"chan-1",
			{ type: "friend-request", from: "Eve" },
			{ onAccept },
		);

		const sentMsg = mockSignalRpcRequest.mock.calls[0][1].message as string;
		const match = sentMsg.match(/ACCEPT (\w+)/);
		const notifId = match![1];

		const parsers = signalChannelProvider.getMessageParsers();
		const notifParser = parsers.find((p) => p.id.startsWith("notif-"));

		const replyFn = vi.fn().mockResolvedValue(undefined);
		await notifParser!.handler({
			channel: "+15559999999",
			channelType: "signal",
			sender: "+15559999999", // not the owner
			content: `ACCEPT ${notifId}`,
			reply: replyFn,
			getBotUsername: () => "+15551234567",
		});

		expect(onAccept).not.toHaveBeenCalled();
		expect(replyFn).not.toHaveBeenCalled();

		await plugin.shutdown();
	});
});
