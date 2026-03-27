import { beforeEach, describe, expect, it, vi } from "vitest";

const mockThread = {
	id: "thread-123",
	runStreamed: vi.fn(),
};

const mockCodexInstance = {
	startThread: vi.fn(() => mockThread),
	resumeThread: vi.fn(() => mockThread),
	listModels: vi.fn(),
};

// Use a regular function (not arrow) so it works as a constructor with `new`
function MockCodex(_opts: any) {
	return mockCodexInstance;
}

vi.mock("@openai/codex-sdk", () => ({
	Codex: MockCodex,
}));

vi.mock("node:fs", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:fs")>();
	return {
		...actual,
		existsSync: vi.fn(() => false),
		readFileSync: vi.fn(() => "{}"),
	};
});

let provider: any;

beforeEach(async () => {
	mockThread.runStreamed.mockReset();
	mockCodexInstance.startThread.mockReset().mockReturnValue(mockThread);
	mockCodexInstance.resumeThread.mockReset().mockReturnValue(mockThread);
	mockCodexInstance.listModels.mockReset();

	const mod = await import("../src/index.js");
	const plugin = mod.default;
	const ctx = {
		log: { info: vi.fn() },
		registerProvider: (p: any) => {
			provider = p;
		},
		registerConfigSchema: vi.fn(),
	};
	await plugin.init?.(ctx as any);
});

async function getClient(credential = "sk-test-key-12345"): Promise<any> {
	return provider.createClient(credential);
}

describe("CodexClient.query", () => {
	it("yields system init event with session ID on thread.started", async () => {
		const events = (async function* () {
			yield { type: "thread.started", thread_id: "sess-abc" };
			yield {
				type: "turn.completed",
				usage: { input_tokens: 10, output_tokens: 5 },
			};
		})();
		mockThread.runStreamed.mockResolvedValue({ events });

		const client = await getClient();
		const results: any[] = [];
		for await (const event of client.query({ prompt: "hello" })) {
			results.push(event);
		}

		expect(results[0]).toEqual({
			type: "system",
			subtype: "init",
			session_id: "sess-abc",
		});
	});

	it("yields result/success at end of turn", async () => {
		const events = (async function* () {
			yield { type: "thread.started", thread_id: "sess-1" };
			yield {
				type: "turn.completed",
				usage: { input_tokens: 10, output_tokens: 5 },
			};
		})();
		mockThread.runStreamed.mockResolvedValue({ events });

		const client = await getClient();
		const results: any[] = [];
		for await (const event of client.query({ prompt: "hello" })) {
			results.push(event);
		}

		const last = results[results.length - 1];
		expect(last).toMatchObject({ type: "result", subtype: "success" });
	});

	it("yields assistant message for agent_message events", async () => {
		const events = (async function* () {
			yield { type: "thread.started", thread_id: "sess-2" };
			yield {
				type: "item.completed",
				item: { type: "agent_message", text: "Hello world" },
			};
			yield {
				type: "turn.completed",
				usage: { input_tokens: 5, output_tokens: 3 },
			};
		})();
		mockThread.runStreamed.mockResolvedValue({ events });

		const client = await getClient();
		const results: any[] = [];
		for await (const event of client.query({ prompt: "hi" })) {
			results.push(event);
		}

		const assistantEvent = results.find((e: any) => e.type === "assistant");
		expect(assistantEvent).toBeDefined();
		expect(assistantEvent.message.content[0]).toEqual({
			type: "text",
			text: "Hello world",
		});
	});

	it("yields tool_use for command_execution events", async () => {
		const events = (async function* () {
			yield { type: "thread.started", thread_id: "sess-3" };
			yield {
				type: "item.completed",
				item: {
					type: "command_execution",
					command: "ls -la",
					aggregated_output: "file.txt",
					exit_code: 0,
				},
			};
			yield {
				type: "turn.completed",
				usage: { input_tokens: 5, output_tokens: 3 },
			};
		})();
		mockThread.runStreamed.mockResolvedValue({ events });

		const client = await getClient();
		const results: any[] = [];
		for await (const event of client.query({ prompt: "list files" })) {
			results.push(event);
		}

		const toolUse = results.find(
			(e: any) =>
				e.type === "assistant" && e.message?.content?.[0]?.type === "tool_use",
		);
		expect(toolUse).toBeDefined();
		expect(toolUse.message.content[0].input.command).toBe("ls -la");
	});

	it("yields system reasoning event for reasoning items", async () => {
		const events = (async function* () {
			yield { type: "thread.started", thread_id: "sess-4" };
			yield {
				type: "item.completed",
				item: { type: "reasoning", text: "I should think..." },
			};
			yield {
				type: "turn.completed",
				usage: { input_tokens: 5, output_tokens: 3 },
			};
		})();
		mockThread.runStreamed.mockResolvedValue({ events });

		const client = await getClient();
		const results: any[] = [];
		for await (const event of client.query({ prompt: "think" })) {
			results.push(event);
		}

		const reasoningEvent = results.find(
			(e: any) => e.type === "system" && e.subtype === "reasoning",
		);
		expect(reasoningEvent).toBeDefined();
		expect(reasoningEvent.content).toBe("I should think...");
	});

	it("yields error result on turn.failed", async () => {
		const events = (async function* () {
			yield { type: "thread.started", thread_id: "sess-5" };
			yield { type: "turn.failed", error: { message: "Rate limit exceeded" } };
		})();
		mockThread.runStreamed.mockResolvedValue({ events });

		const client = await getClient();
		const results: any[] = [];
		for await (const event of client.query({ prompt: "fail" })) {
			results.push(event);
		}

		const errorEvent = results.find(
			(e: any) => e.type === "result" && e.subtype === "error",
		);
		expect(errorEvent).toBeDefined();
		expect(errorEvent.errors[0].message).toBe("Rate limit exceeded");
	});

	it("resumes thread when opts.resume is provided", async () => {
		const events = (async function* () {
			yield { type: "thread.started", thread_id: "resumed-sess" };
			yield {
				type: "turn.completed",
				usage: { input_tokens: 1, output_tokens: 1 },
			};
		})();
		mockThread.runStreamed.mockResolvedValue({ events });

		const client = await getClient();
		const results: any[] = [];
		for await (const event of client.query({
			prompt: "continue",
			resume: "old-thread-id",
		})) {
			results.push(event);
		}

		expect(mockCodexInstance.resumeThread).toHaveBeenCalledWith(
			"old-thread-id",
		);
	});

	it("throws wrapped error on SDK failure", async () => {
		mockThread.runStreamed.mockRejectedValue(new Error("SDK crashed"));

		const client = await getClient();
		await expect(async () => {
			for await (const _event of client.query({ prompt: "crash" })) {
				// consume
			}
		}).rejects.toThrow("Codex query failed: SDK crashed");
	});
});

describe("CodexClient.listModels", () => {
	it("returns model IDs from SDK response items array", async () => {
		mockCodexInstance.listModels.mockResolvedValue({
			items: [{ model: "codex-mini" }, { model: "codex-large" }],
		});

		const client = await getClient();
		const models = await client.listModels();
		expect(models).toEqual(["codex-mini", "codex-large"]);
	});

	it("returns empty array on error", async () => {
		mockCodexInstance.listModels.mockRejectedValue(new Error("network"));

		const client = await getClient();
		const models = await client.listModels();
		expect(models).toEqual([]);
	});

	it("handles flat array response", async () => {
		mockCodexInstance.listModels.mockResolvedValue([
			{ model: "model-a" },
			{ name: "model-b" },
		]);

		const client = await getClient();
		const models = await client.listModels();
		expect(models).toContain("model-a");
	});
});

describe("CodexClient.healthCheck", () => {
	it("returns true when thread can be started", async () => {
		const client = await getClient();
		const healthy = await client.healthCheck();
		expect(healthy).toBe(true);
	});

	it("returns false when SDK throws", async () => {
		mockCodexInstance.startThread.mockImplementationOnce(() => {
			throw new Error("no auth");
		});

		const client = await getClient();
		const healthy = await client.healthCheck();
		expect(healthy).toBe(false);
	});
});
