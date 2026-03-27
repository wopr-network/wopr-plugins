import { beforeEach, describe, expect, it, vi } from "vitest";

// Track fetch calls for attachment downloads
const fetchMock = vi.fn();
global.fetch = fetchMock as any;

/** Helper: build a mock fetch Response with arrayBuffer() */
function mockFetchOk(data: string) {
	const buf = new TextEncoder().encode(data).buffer;
	return { ok: true, arrayBuffer: () => Promise.resolve(buf) };
}

// Mock fs functions used by saveAttachments
const mockExistsSync = vi.fn().mockReturnValue(true);
const mockMkdirSync = vi.fn();
const mockWriteFileSync = vi.fn();

vi.mock("node:fs", async () => {
	const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
	return {
		...actual,
		existsSync: (...args: any[]) => mockExistsSync(...args),
		mkdirSync: (...args: any[]) => mockMkdirSync(...args),
		writeFileSync: (...args: any[]) => mockWriteFileSync(...args),
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

// Shared bolt mock state (must be declared before vi.mock)
const sharedBoltMocks = {
	start: vi.fn(),
	stop: vi.fn(),
	message: vi.fn(),
	event: vi.fn(),
	command: vi.fn(),
	authTest: vi.fn().mockResolvedValue({ user_id: "UBOT123" }),
	reactionsAdd: vi.fn(),
	reactionsRemove: vi.fn(),
	chatUpdate: vi.fn(),
	chatPostMessage: vi.fn(),
	chatDelete: vi.fn(),
};

vi.mock("@slack/bolt", () => {
	class MockApp {
		start = sharedBoltMocks.start;
		stop = sharedBoltMocks.stop;
		message = sharedBoltMocks.message;
		event = sharedBoltMocks.event;
		command = sharedBoltMocks.command;
		action = vi.fn();
		client = {
			auth: { test: sharedBoltMocks.authTest },
			reactions: { add: sharedBoltMocks.reactionsAdd, remove: sharedBoltMocks.reactionsRemove },
			chat: { update: sharedBoltMocks.chatUpdate, postMessage: sharedBoltMocks.chatPostMessage, delete: sharedBoltMocks.chatDelete },
		};
	}
	return {
		App: MockApp,
		FileInstallationStore: vi.fn(),
		LogLevel: { INFO: "info" },
	};
});

describe("saveAttachments", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockExistsSync.mockReturnValue(true);
	});

	it("returns empty array when no files provided", async () => {
		const { saveAttachments } = await import("../src/index.js");
		const result = await saveAttachments([], "U123", "xoxb-token");
		expect(result).toEqual([]);
	});

	it("downloads files using bot token in Authorization header", async () => {
		fetchMock.mockResolvedValueOnce(mockFetchOk("file content"));

		const { saveAttachments } = await import("../src/index.js");
		const files = [
			{
				id: "F001",
				name: "report.pdf",
				url_private_download: "https://files.slack.com/files-pri/T123/download/report.pdf",
				size: 1024,
				mimetype: "application/pdf",
			},
		];

		const result = await saveAttachments(files, "U456", "xoxb-test-token");

		expect(fetchMock).toHaveBeenCalledWith(
			"https://files.slack.com/files-pri/T123/download/report.pdf",
			{ headers: { Authorization: "Bearer xoxb-test-token" } },
		);
		expect(result).toHaveLength(1);
		expect(result[0]).toContain("report.pdf");
	});

	it("falls back to url_private when url_private_download is missing", async () => {
		fetchMock.mockResolvedValueOnce(mockFetchOk("file content"));

		const { saveAttachments } = await import("../src/index.js");
		const files = [
			{
				id: "F002",
				name: "image.png",
				url_private: "https://files.slack.com/files-pri/T123/image.png",
				size: 2048,
				mimetype: "image/png",
			},
		];

		const result = await saveAttachments(files, "U789", "xoxb-token");

		expect(fetchMock).toHaveBeenCalledWith(
			"https://files.slack.com/files-pri/T123/image.png",
			expect.objectContaining({ headers: { Authorization: "Bearer xoxb-token" } }),
		);
		expect(result).toHaveLength(1);
	});

	it("skips files with no download URL", async () => {
		const { saveAttachments } = await import("../src/index.js");
		const files = [{ id: "F003", name: "nourl.txt" }];

		const result = await saveAttachments(files, "U123", "xoxb-token");
		expect(result).toEqual([]);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("skips files that fail to download (non-ok response)", async () => {
		fetchMock.mockResolvedValueOnce({ ok: false, status: 403 });

		const { saveAttachments } = await import("../src/index.js");
		const files = [
			{
				id: "F004",
				name: "forbidden.txt",
				url_private_download: "https://files.slack.com/forbidden.txt",
			},
		];

		const result = await saveAttachments(files, "U123", "xoxb-token");
		expect(result).toEqual([]);
	});

	it("handles multiple files and continues on individual failures", async () => {
		fetchMock
			.mockResolvedValueOnce(mockFetchOk("a"))
			.mockResolvedValueOnce({ ok: false, status: 500 })
			.mockResolvedValueOnce(mockFetchOk("c"));

		const { saveAttachments } = await import("../src/index.js");
		const files = [
			{
				id: "F010",
				name: "file1.txt",
				url_private_download: "https://files.slack.com/file1.txt",
			},
			{
				id: "F011",
				name: "file2.txt",
				url_private_download: "https://files.slack.com/file2.txt",
			},
			{
				id: "F012",
				name: "file3.txt",
				url_private_download: "https://files.slack.com/file3.txt",
			},
		];

		const result = await saveAttachments(files, "U123", "xoxb-token");
		expect(result).toHaveLength(2);
		expect(result[0]).toContain("file1.txt");
		expect(result[1]).toContain("file3.txt");
	});

	it("sanitizes filenames to remove special characters", async () => {
		fetchMock.mockResolvedValueOnce(mockFetchOk("data"));

		const { saveAttachments } = await import("../src/index.js");
		const files = [
			{
				id: "F020",
				name: "my file (1) [final].txt",
				url_private_download: "https://files.slack.com/download",
			},
		];

		const result = await saveAttachments(files, "U123", "xoxb-token");
		expect(result).toHaveLength(1);
		// Special chars replaced with underscores
		expect(result[0]).toContain("my_file__1___final_.txt");
	});

	it("creates attachments directory if it does not exist", async () => {
		// First call for ATTACHMENTS_DIR constant (module-level) returns true
		// Second call inside saveAttachments returns false (dir doesn't exist)
		mockExistsSync.mockReturnValue(false);
		fetchMock.mockResolvedValueOnce(mockFetchOk("data"));

		const { saveAttachments } = await import("../src/index.js");
		const files = [
			{
				id: "F030",
				name: "test.txt",
				url_private_download: "https://files.slack.com/test.txt",
			},
		];

		await saveAttachments(files, "U123", "xoxb-token");
		expect(mockMkdirSync).toHaveBeenCalledWith(
			expect.any(String),
			{ recursive: true },
		);
	});

	it("handles fetch throwing an error gracefully", async () => {
		fetchMock.mockRejectedValueOnce(new Error("Network error"));

		const { saveAttachments } = await import("../src/index.js");
		const files = [
			{
				id: "F040",
				name: "error.txt",
				url_private_download: "https://files.slack.com/error.txt",
			},
		];

		const result = await saveAttachments(files, "U123", "xoxb-token");
		expect(result).toEqual([]);
	});

	it("uses default name 'attachment' when file.name is undefined", async () => {
		fetchMock.mockResolvedValueOnce(mockFetchOk("data"));

		const { saveAttachments } = await import("../src/index.js");
		const files = [
			{
				id: "F050",
				url_private_download: "https://files.slack.com/download",
			},
		];

		const result = await saveAttachments(files, "U123", "xoxb-token");
		expect(result).toHaveLength(1);
		expect(result[0]).toContain("attachment");
	});
});

describe("message handler file attachment integration", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		sharedBoltMocks.authTest.mockResolvedValue({ user_id: "UBOT123" });
		mockExistsSync.mockReturnValue(true);
	});

	function mockContext(configOverride: Record<string, any> = {}) {
		let storedConfig = structuredClone(configOverride);
		return {
			inject: vi.fn().mockResolvedValue("response text"),
			logMessage: vi.fn(),
			injectPeer: vi.fn(),
			getIdentity: () => ({ publicKey: "pk", shortId: "id", encryptPub: "ep" }),
			getAgentIdentity: vi.fn().mockResolvedValue({ name: "WOPR", emoji: "eyes" }),
			getUserProfile: () => ({}),
			getSessions: () => [],
			getPeers: () => [],
			getConfig: () => storedConfig as any,
			saveConfig: vi.fn(async (c: any) => { storedConfig = c; }),
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
		} as any;
	}

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
		const messageHandler = sharedBoltMocks.message.mock.calls[0]?.[0];
		return { plugin, ctx, messageHandler };
	}

	it("processes messages with files but no text", async () => {
		fetchMock.mockResolvedValueOnce(mockFetchOk("file data"));

		const { ctx, messageHandler } = await initPluginWithConfig({
			dm: { enabled: true, policy: "open" },
		});
		const say = vi.fn().mockResolvedValue({ ts: "file_ts" });

		await messageHandler({
			message: {
				user: "U_FILE_1",
				ts: "t_file",
				files: [
					{
						id: "F100",
						name: "doc.pdf",
						url_private_download: "https://files.slack.com/doc.pdf",
						size: 500,
						mimetype: "application/pdf",
					},
				],
			},
			context: { channel: "D_FILE_DM", botUserId: "UBOT123" },
			say,
		});

		expect(ctx.inject).toHaveBeenCalledWith(
			expect.any(String),
			expect.stringContaining("[Attachment:"),
			expect.any(Object),
		);
	});

	it("appends attachment paths to text content", async () => {
		fetchMock.mockResolvedValueOnce(mockFetchOk("image data"));

		const { ctx, messageHandler } = await initPluginWithConfig({
			dm: { enabled: true, policy: "open" },
		});
		const say = vi.fn().mockResolvedValue({ ts: "mixed_ts" });

		await messageHandler({
			message: {
				text: "Check out this image",
				user: "U_MIX_1",
				ts: "t_mix",
				files: [
					{
						id: "F200",
						name: "screenshot.png",
						url_private_download: "https://files.slack.com/screenshot.png",
						size: 2000,
						mimetype: "image/png",
					},
				],
			},
			context: { channel: "D_MIX_DM", botUserId: "UBOT123" },
			say,
		});

		// The inject call should contain both the text and attachment info
		const injectCall = (ctx.inject as any).mock.calls[0];
		expect(injectCall[1]).toContain("Check out this image");
		expect(injectCall[1]).toContain("[Attachment:");
		expect(injectCall[1]).toContain("screenshot.png");
	});

	it("handles multiple file attachments", async () => {
		fetchMock
			.mockResolvedValueOnce(mockFetchOk("a"))
			.mockResolvedValueOnce(mockFetchOk("b"));

		const { ctx, messageHandler } = await initPluginWithConfig({
			dm: { enabled: true, policy: "open" },
		});
		const say = vi.fn().mockResolvedValue({ ts: "multi_ts" });

		await messageHandler({
			message: {
				text: "Here are two files",
				user: "U_MULTI",
				ts: "t_multi",
				files: [
					{
						id: "F300",
						name: "file1.txt",
						url_private_download: "https://files.slack.com/file1.txt",
					},
					{
						id: "F301",
						name: "file2.txt",
						url_private_download: "https://files.slack.com/file2.txt",
					},
				],
			},
			context: { channel: "D_MULTI_DM", botUserId: "UBOT123" },
			say,
		});

		const injectCall = (ctx.inject as any).mock.calls[0];
		expect(injectCall[1]).toContain("file1.txt");
		expect(injectCall[1]).toContain("file2.txt");
	});

	it("skips messages with neither text nor files", async () => {
		const { ctx, messageHandler } = await initPluginWithConfig({
			dm: { enabled: true, policy: "open" },
		});
		const say = vi.fn().mockResolvedValue({ ts: "empty_ts" });

		await messageHandler({
			message: { user: "U_EMPTY", ts: "t_empty" },
			context: { channel: "D_EMPTY_DM", botUserId: "UBOT123" },
			say,
		});

		expect(ctx.inject).not.toHaveBeenCalled();
	});
});
