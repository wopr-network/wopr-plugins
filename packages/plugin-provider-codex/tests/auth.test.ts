import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@openai/codex-sdk", () => ({
	Codex: vi.fn(),
}));

const mockExistsSync = vi.fn(() => false);
const mockReadFileSync = vi.fn(() => "{}");

vi.mock("node:fs", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:fs")>();
	return {
		...actual,
		existsSync: mockExistsSync,
		readFileSync: mockReadFileSync,
	};
});

describe("auth detection", () => {
	const originalEnv = process.env;

	beforeEach(() => {
		vi.resetModules();
		process.env = { ...originalEnv };
		delete process.env.OPENAI_API_KEY;
		mockExistsSync.mockReturnValue(false);
		mockReadFileSync.mockReturnValue("{}");
	});

	afterEach(() => {
		process.env = originalEnv;
	});

	it("returns false for empty credential with no auth sources", async () => {
		const mod = await import("../src/index.js");
		const plugin = mod.default;
		const provider = captureProvider(plugin);
		const valid = await provider.validateCredentials("");
		expect(valid).toBe(false);
	});

	it("returns false for non-sk- prefixed API key", async () => {
		const mod = await import("../src/index.js");
		const plugin = mod.default;
		const provider = captureProvider(plugin);
		const valid = await provider.validateCredentials("not-a-valid-key");
		expect(valid).toBe(false);
	});

	it("returns true when OPENAI_API_KEY env var is set (empty credential)", async () => {
		process.env.OPENAI_API_KEY = "sk-test-key-12345";
		const mod = await import("../src/index.js");
		const plugin = mod.default;
		const provider = captureProvider(plugin);
		const valid = await provider.validateCredentials("");
		expect(valid).toBe(true);
	});

	it("detects OAuth from ~/.codex/auth.json", async () => {
		mockExistsSync.mockReturnValue(true);
		const idTokenPayload = Buffer.from(
			JSON.stringify({
				email: "test@example.com",
				"https://api.openai.com/auth": { chatgpt_plan_type: "plus" },
			}),
		).toString("base64");
		mockReadFileSync.mockReturnValue(
			JSON.stringify({
				tokens: {
					access_token: "test-access-token",
					refresh_token: "test-refresh-token",
					id_token: `header.${idTokenPayload}.sig`,
				},
			}),
		);

		const mod = await import("../src/index.js");
		const plugin = mod.default;
		const provider = captureProvider(plugin);
		const valid = await provider.validateCredentials("");
		expect(valid).toBe(true);
	});

	it("getAuthMethods returns 3 methods", async () => {
		const mod = await import("../src/index.js");
		const plugin = mod.default;
		const provider = captureProvider(plugin) as any;
		const methods = provider.getAuthMethods();
		expect(methods).toHaveLength(3);
		expect(methods.map((m: any) => m.id)).toEqual(["oauth", "env", "api-key"]);
	});

	it("getActiveAuthMethod returns 'none' when no auth configured", async () => {
		const mod = await import("../src/index.js");
		const plugin = mod.default;
		const provider = captureProvider(plugin) as any;
		expect(provider.getActiveAuthMethod()).toBe("none");
	});

	it("getActiveAuthMethod returns 'api-key' when OPENAI_API_KEY is set", async () => {
		process.env.OPENAI_API_KEY = "sk-env-key-12345";
		const mod = await import("../src/index.js");
		const plugin = mod.default;
		const provider = captureProvider(plugin) as any;
		expect(provider.getActiveAuthMethod()).toBe("api-key");
	});

	it("getCredentialType returns 'api-key' when no oauth", async () => {
		const mod = await import("../src/index.js");
		const plugin = mod.default;
		const provider = captureProvider(plugin) as any;
		expect(provider.getCredentialType()).toBe("api-key");
	});
});

function captureProvider(plugin: any): any {
	let capturedProvider: any;
	const ctx = {
		log: { info: vi.fn() },
		registerProvider: (p: any) => {
			capturedProvider = p;
		},
		registerConfigSchema: vi.fn(),
	};
	plugin.init(ctx);
	return capturedProvider;
}
