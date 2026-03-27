import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock @larksuiteoapi/node-sdk before importing plugin
vi.mock("@larksuiteoapi/node-sdk", () => {
	const Domain = { Feishu: 0, Lark: 1 };
	const AppType = { SelfBuild: 0 };
	const LoggerLevel = { info: 3 };

	const mockClient = {
		im: {
			message: {
				create: vi.fn().mockResolvedValue({}),
			},
		},
	};

	const mockWSClient = {
		start: vi.fn(),
		close: vi.fn(),
	};

	const mockEventDispatcher = {
		register: vi.fn().mockReturnThis(),
	};

	const mockCardHandler = {};

	return {
		Domain,
		AppType,
		LoggerLevel,
		Client: vi.fn(() => mockClient),
		WSClient: vi.fn(() => mockWSClient),
		EventDispatcher: vi.fn(() => mockEventDispatcher),
		CardActionHandler: vi.fn(() => mockCardHandler),
		adaptDefault: vi.fn(
			() => (_req: unknown, _res: unknown) => Promise.resolve(),
		),
	};
});

// Mock winston
vi.mock("winston", () => {
	const mockLogger = {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	};
	const transports = {
		Console: vi.fn(),
		File: vi.fn(),
	};
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

// Mock node:http
vi.mock("node:http", () => {
	const mockServer = {
		listen: vi.fn(),
		close: vi.fn(),
		on: vi.fn(),
	};
	return {
		default: {
			createServer: vi.fn(() => mockServer),
		},
	};
});

// Mock node:path
vi.mock("node:path", () => {
	return {
		default: {
			join: vi.fn((...args: string[]) => args.join("/")),
		},
	};
});

import {
	buildSessionKey,
	extractTextFromContent,
	resolveDomain,
	resolveCredentials,
	shouldRespond,
	stripBotMention,
} from "../../src/index.js";
import type { FeishuConfig } from "../../src/types.js";

// ─── extractTextFromContent ────────────────────────────────────────────────────

describe("extractTextFromContent", () => {
	it("extracts text from 'text' message type", () => {
		const content = JSON.stringify({ text: "Hello, World!" });
		expect(extractTextFromContent("text", content)).toBe("Hello, World!");
	});

	it("extracts text from 'post' message with zh_cn locale", () => {
		const content = JSON.stringify({
			zh_cn: {
				title: "Title",
				content: [
					[
						{ tag: "text", text: "Hello" },
						{ tag: "a", text: "Link", href: "https://example.com" },
						{ tag: "text", text: " World" },
					],
				],
			},
		});
		expect(extractTextFromContent("post", content)).toBe("Hello World");
	});

	it("extracts text from 'post' message with en_us locale when zh_cn missing", () => {
		const content = JSON.stringify({
			en_us: {
				title: "Title",
				content: [
					[{ tag: "text", text: "Hello from en_us" }],
					[{ tag: "text", text: "Second paragraph" }],
				],
			},
		});
		expect(extractTextFromContent("post", content)).toBe(
			"Hello from en_us Second paragraph",
		);
	});

	it("returns '[image]' for image message type", () => {
		const content = JSON.stringify({ image_key: "img_xxx" });
		expect(extractTextFromContent("image", content)).toBe("[image]");
	});

	it("returns '[unsupported: audio]' for unsupported types", () => {
		const content = JSON.stringify({ file_key: "file_xxx" });
		expect(extractTextFromContent("audio", content)).toBe(
			"[unsupported: audio]",
		);
	});

	it("handles malformed JSON content gracefully", () => {
		const content = "not-valid-json";
		expect(extractTextFromContent("text", content)).toBe("not-valid-json");
	});
});

// ─── stripBotMention ──────────────────────────────────────────────────────────

describe("stripBotMention", () => {
	it("strips @_user_N placeholders from text", () => {
		const result = stripBotMention("Hey @_user_1 how are you?");
		expect(result).toBe("Hey how are you?");
	});

	it("strips multiple @_user_N placeholders", () => {
		const result = stripBotMention("@_user_1 @_user_2 hello");
		expect(result).toBe("hello");
	});

	it("returns trimmed result", () => {
		const result = stripBotMention("  @_user_1   hello  ");
		expect(result).toBe("hello");
	});

	it("handles text with no mentions", () => {
		const result = stripBotMention("just a normal message");
		expect(result).toBe("just a normal message");
	});
});

// ─── buildSessionKey ──────────────────────────────────────────────────────────

describe("buildSessionKey", () => {
	it("returns feishu-dm-xxx for p2p chat type", () => {
		expect(buildSessionKey("oc_123", "p2p")).toBe("feishu-dm-oc_123");
	});

	it("returns feishu-group-xxx for group chat type", () => {
		expect(buildSessionKey("oc_456", "group")).toBe("feishu-group-oc_456");
	});
});

// ─── shouldRespond ────────────────────────────────────────────────────────────

describe("shouldRespond", () => {
	it("returns true for p2p with default dmPolicy (open)", () => {
		expect(shouldRespond("p2p", [])).toBe(true);
	});

	it("returns true for group with any mention when policy is mention (default)", () => {
		expect(shouldRespond("group", [{ name: "SomeBot" }])).toBe(true);
	});

	it("returns false for group with no mentions when policy is mention", () => {
		expect(shouldRespond("group", [])).toBe(false);
	});
});

// ─── resolveCredentials ───────────────────────────────────────────────────────

describe("resolveCredentials", () => {
	const origEnv = process.env;

	beforeEach(() => {
		process.env = { ...origEnv };
		delete process.env.FEISHU_APP_ID;
		delete process.env.FEISHU_APP_SECRET;
	});

	afterEach(() => {
		process.env = origEnv;
	});

	it("returns config values when present", () => {
		const cfg: FeishuConfig = { appId: "cli_test", appSecret: "secret_test" };
		const creds = resolveCredentials(cfg);
		expect(creds.appId).toBe("cli_test");
		expect(creds.appSecret).toBe("secret_test");
	});

	it("falls back to env vars when config values missing", () => {
		process.env.FEISHU_APP_ID = "env_app_id";
		process.env.FEISHU_APP_SECRET = "env_app_secret";
		const creds = resolveCredentials({});
		expect(creds.appId).toBe("env_app_id");
		expect(creds.appSecret).toBe("env_app_secret");
	});

	it("throws when neither config nor env vars are set", () => {
		expect(() => resolveCredentials({})).toThrow(
			"Feishu appId and appSecret are required",
		);
	});
});

// ─── resolveDomain ────────────────────────────────────────────────────────────

describe("resolveDomain", () => {
	it("returns Feishu domain (0) for 'feishu'", () => {
		expect(resolveDomain({ domain: "feishu" })).toBe(0);
	});

	it("returns Lark domain (1) for 'lark'", () => {
		expect(resolveDomain({ domain: "lark" })).toBe(1);
	});

	it("returns Feishu domain (0) as default for unknown domain", () => {
		expect(resolveDomain({ domain: "custom" })).toBe(0);
	});

	it("returns Feishu domain (0) when domain is undefined", () => {
		expect(resolveDomain({})).toBe(0);
	});
});

// ─── Plugin lifecycle ─────────────────────────────────────────────────────────

describe("plugin lifecycle", () => {
	it("has correct name, version, and manifest", async () => {
		const { default: plugin } = await import("../../src/index.js");
		expect(plugin.name).toBe("@wopr-network/wopr-plugin-feishu");
		expect(plugin.version).toBe("1.0.0");
		expect(plugin.manifest).toBeDefined();
		expect(plugin.manifest?.capabilities).toContain("channel");
		expect(plugin.manifest?.icon).toBeDefined();
		expect(plugin.manifest?.category).toBe("communication");
	});

	it("init() registers config schema, channel provider, and skips bot start when credentials missing", async () => {
		const { default: plugin } = await import("../../src/index.js");

		const mockCtx = {
			getConfig: vi.fn(() => ({})),
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
			storage: {
				register: vi.fn(),
				getRepository: vi.fn(),
			},
			events: {
				on: vi.fn(),
				once: vi.fn(),
				emitCustom: vi.fn(),
			},
			hooks: {
				on: vi.fn(),
				off: vi.fn(),
			},
		};

		await expect(plugin.init!(mockCtx as never)).resolves.toBeUndefined();
		expect(mockCtx.registerConfigSchema).toHaveBeenCalledWith(
			"wopr-plugin-feishu",
			expect.objectContaining({ title: "Feishu/Lark Plugin" }),
		);
		expect(mockCtx.registerChannelProvider).toHaveBeenCalledWith(
			expect.objectContaining({ id: "feishu" }),
		);
	});

	it("shutdown() cleans up state without throwing", async () => {
		const { default: plugin } = await import("../../src/index.js");
		await expect(plugin.shutdown!()).resolves.toBeUndefined();
	});
});
