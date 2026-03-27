import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../src/lib/api";

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function mockJsonResponse(data: unknown, ok = true, status = 200) {
	return {
		ok,
		status,
		json: vi.fn().mockResolvedValue(data),
	};
}

beforeEach(() => {
	mockFetch.mockReset();
});

describe("api.getSessions", () => {
	it("should GET /api/sessions", async () => {
		const sessions = { sessions: [{ name: "test-session" }] };
		mockFetch.mockResolvedValue(mockJsonResponse(sessions));

		const result = await api.getSessions();

		expect(mockFetch).toHaveBeenCalledWith("/api/sessions", {
			headers: { "Content-Type": "application/json" },
		});
		expect(result).toEqual(sessions);
	});
});

describe("api.createSession", () => {
	it("should POST /api/sessions with name and context", async () => {
		const session = { name: "new-session", id: "abc" };
		mockFetch.mockResolvedValue(mockJsonResponse(session));

		const result = await api.createSession("new-session", "some context");

		expect(mockFetch).toHaveBeenCalledWith("/api/sessions", {
			method: "POST",
			body: JSON.stringify({ name: "new-session", context: "some context" }),
			headers: { "Content-Type": "application/json" },
		});
		expect(result).toEqual(session);
	});

	it("should POST without context when not provided", async () => {
		mockFetch.mockResolvedValue(mockJsonResponse({ name: "s1" }));

		await api.createSession("s1");

		const body = JSON.parse(mockFetch.mock.calls[0][1].body);
		expect(body.name).toBe("s1");
		expect(body.context).toBeUndefined();
	});
});

describe("api.deleteSession", () => {
	it("should DELETE /api/sessions/:name", async () => {
		mockFetch.mockResolvedValue(mockJsonResponse({}));

		await api.deleteSession("my-session");

		expect(mockFetch).toHaveBeenCalledWith("/api/sessions/my-session", {
			method: "DELETE",
			headers: { "Content-Type": "application/json" },
		});
	});

	it("should encode special characters in session name", async () => {
		mockFetch.mockResolvedValue(mockJsonResponse({}));

		await api.deleteSession("session with spaces");

		expect(mockFetch).toHaveBeenCalledWith("/api/sessions/session%20with%20spaces", expect.any(Object));
	});
});

describe("api.inject", () => {
	it("should POST message to session inject endpoint", async () => {
		const response = {
			session: "test",
			sessionId: "abc",
			response: "hello",
			cost: 0.01,
		};
		mockFetch.mockResolvedValue(mockJsonResponse(response));

		const result = await api.inject("test", "hello world");

		expect(mockFetch).toHaveBeenCalledWith("/api/sessions/test/inject", {
			method: "POST",
			body: JSON.stringify({ message: "hello world" }),
			headers: { "Content-Type": "application/json" },
		});
		expect(result).toEqual(response);
	});
});

describe("api.getAuthStatus", () => {
	it("should GET /api/auth", async () => {
		const auth = { authenticated: true, type: "oauth" };
		mockFetch.mockResolvedValue(mockJsonResponse(auth));

		const result = await api.getAuthStatus();

		expect(mockFetch).toHaveBeenCalledWith("/api/auth", {
			headers: { "Content-Type": "application/json" },
		});
		expect(result).toEqual(auth);
	});
});

describe("api.getCrons", () => {
	it("should GET /api/crons", async () => {
		const crons = { crons: [{ name: "daily", schedule: "0 0 * * *" }] };
		mockFetch.mockResolvedValue(mockJsonResponse(crons));

		const result = await api.getCrons();

		expect(result).toEqual(crons);
	});
});

describe("api.createCron", () => {
	it("should POST /api/crons with cron data", async () => {
		const cron = {
			name: "hourly",
			schedule: "0 * * * *",
			session: "default",
			message: "check status",
		};
		mockFetch.mockResolvedValue(mockJsonResponse({ ...cron, id: "1" }));

		await api.createCron(cron);

		expect(mockFetch).toHaveBeenCalledWith("/api/crons", {
			method: "POST",
			body: JSON.stringify(cron),
			headers: { "Content-Type": "application/json" },
		});
	});
});

describe("api.deleteCron", () => {
	it("should DELETE /api/crons/:name", async () => {
		mockFetch.mockResolvedValue(mockJsonResponse({}));

		await api.deleteCron("hourly");

		expect(mockFetch).toHaveBeenCalledWith("/api/crons/hourly", {
			method: "DELETE",
			headers: { "Content-Type": "application/json" },
		});
	});
});

describe("api.getPeers", () => {
	it("should GET /api/peers", async () => {
		const peers = { peers: [{ id: "peer1" }] };
		mockFetch.mockResolvedValue(mockJsonResponse(peers));

		const result = await api.getPeers();

		expect(result).toEqual(peers);
	});
});

describe("api.getPlugins", () => {
	it("should GET /api/plugins", async () => {
		const plugins = { plugins: [{ name: "webui" }] };
		mockFetch.mockResolvedValue(mockJsonResponse(plugins));

		const result = await api.getPlugins();

		expect(result).toEqual(plugins);
	});
});

describe("api.getWebUiExtensions", () => {
	it("should GET /api/plugins/ui", async () => {
		const extensions = {
			extensions: [{ id: "main", title: "Dashboard", url: "http://localhost" }],
		};
		mockFetch.mockResolvedValue(mockJsonResponse(extensions));

		const result = await api.getWebUiExtensions();

		expect(mockFetch).toHaveBeenCalledWith("/api/plugins/ui", {
			headers: { "Content-Type": "application/json" },
		});
		expect(result).toEqual(extensions);
	});
});

describe("api.getUiComponents", () => {
	it("should GET /api/plugins/components", async () => {
		const components = {
			components: [{ id: "sidebar", title: "Nav", moduleUrl: "/mod.js", slot: "sidebar" }],
		};
		mockFetch.mockResolvedValue(mockJsonResponse(components));

		const result = await api.getUiComponents();

		expect(mockFetch).toHaveBeenCalledWith("/api/plugins/components", {
			headers: { "Content-Type": "application/json" },
		});
		expect(result).toEqual(components);
	});
});

describe("api.getIdentity", () => {
	it("should GET /api/identity", async () => {
		const identity = { id: "abc", name: "wopr-node" };
		mockFetch.mockResolvedValue(mockJsonResponse(identity));

		const result = await api.getIdentity();

		expect(result).toEqual(identity);
	});
});

describe("api.initIdentity", () => {
	it("should POST /api/identity", async () => {
		mockFetch.mockResolvedValue(mockJsonResponse({ id: "new" }));

		await api.initIdentity();

		expect(mockFetch).toHaveBeenCalledWith("/api/identity", {
			method: "POST",
			body: JSON.stringify({ force: undefined }),
			headers: { "Content-Type": "application/json" },
		});
	});

	it("should pass force flag", async () => {
		mockFetch.mockResolvedValue(mockJsonResponse({ id: "new" }));

		await api.initIdentity(true);

		const body = JSON.parse(mockFetch.mock.calls[0][1].body);
		expect(body.force).toBe(true);
	});
});

describe("api.getConfig", () => {
	it("should GET /api/config", async () => {
		const config = { daemon: { port: 7437, host: "127.0.0.1", autoStart: true } };
		mockFetch.mockResolvedValue(mockJsonResponse(config));

		const result = await api.getConfig();

		expect(result).toEqual(config);
	});
});

describe("api.getConfigValue", () => {
	it("should GET /api/config/:key and return value", async () => {
		mockFetch.mockResolvedValue(mockJsonResponse({ key: "daemon.port", value: 7437 }));

		const result = await api.getConfigValue("daemon.port");

		expect(mockFetch).toHaveBeenCalledWith("/api/config/daemon.port", {
			headers: { "Content-Type": "application/json" },
		});
		expect(result).toBe(7437);
	});
});

describe("api.setConfigValue", () => {
	it("should PUT /api/config/:key with value", async () => {
		mockFetch.mockResolvedValue(mockJsonResponse({}));

		await api.setConfigValue("daemon.port", 8080);

		expect(mockFetch).toHaveBeenCalledWith("/api/config/daemon.port", {
			method: "PUT",
			body: JSON.stringify({ value: 8080 }),
			headers: { "Content-Type": "application/json" },
		});
	});
});

describe("api.resetConfig", () => {
	it("should DELETE /api/config", async () => {
		mockFetch.mockResolvedValue(mockJsonResponse({}));

		await api.resetConfig();

		expect(mockFetch).toHaveBeenCalledWith("/api/config", {
			method: "DELETE",
			headers: { "Content-Type": "application/json" },
		});
	});
});

describe("api.getSkills", () => {
	it("should GET /api/skills", async () => {
		const skills = {
			skills: [{ id: "s1", name: "greet", description: "Greeting skill", enabled: true }],
		};
		mockFetch.mockResolvedValue(mockJsonResponse(skills));

		const result = await api.getSkills();

		expect(mockFetch).toHaveBeenCalledWith("/api/skills", {
			headers: { "Content-Type": "application/json" },
		});
		expect(result).toEqual(skills);
	});
});

describe("api.getAvailableSkills", () => {
	it("should GET /api/skills/available", async () => {
		const skills = {
			skills: [{ id: "s2", name: "search", description: "Web search", category: "tools" }],
		};
		mockFetch.mockResolvedValue(mockJsonResponse(skills));

		const result = await api.getAvailableSkills();

		expect(mockFetch).toHaveBeenCalledWith("/api/skills/available", {
			headers: { "Content-Type": "application/json" },
		});
		expect(result).toEqual(skills);
	});
});

describe("api.installSkill", () => {
	it("should POST /api/skills/install with id", async () => {
		mockFetch.mockResolvedValue(mockJsonResponse({}));

		await api.installSkill("s2");

		expect(mockFetch).toHaveBeenCalledWith("/api/skills/install", {
			method: "POST",
			body: JSON.stringify({ id: "s2" }),
			headers: { "Content-Type": "application/json" },
		});
	});
});

describe("api.uninstallSkill", () => {
	it("should POST /api/skills/uninstall with id", async () => {
		mockFetch.mockResolvedValue(mockJsonResponse({}));

		await api.uninstallSkill("s1");

		expect(mockFetch).toHaveBeenCalledWith("/api/skills/uninstall", {
			method: "POST",
			body: JSON.stringify({ id: "s1" }),
			headers: { "Content-Type": "application/json" },
		});
	});
});

describe("api.enableSkill", () => {
	it("should POST /api/skills/:id/enable", async () => {
		mockFetch.mockResolvedValue(mockJsonResponse({}));

		await api.enableSkill("s1");

		expect(mockFetch).toHaveBeenCalledWith("/api/skills/s1/enable", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
		});
	});

	it("should encode special characters in skill id", async () => {
		mockFetch.mockResolvedValue(mockJsonResponse({}));

		await api.enableSkill("skill with spaces");

		expect(mockFetch).toHaveBeenCalledWith("/api/skills/skill%20with%20spaces/enable", expect.any(Object));
	});
});

describe("api.disableSkill", () => {
	it("should POST /api/skills/:id/disable", async () => {
		mockFetch.mockResolvedValue(mockJsonResponse({}));

		await api.disableSkill("s1");

		expect(mockFetch).toHaveBeenCalledWith("/api/skills/s1/disable", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
		});
	});
});

describe("error handling", () => {
	it("should throw on non-ok response with error message from body", async () => {
		mockFetch.mockResolvedValue(mockJsonResponse({ error: "Session not found" }, false, 404));

		await expect(api.getSessions()).rejects.toThrow("Session not found");
	});

	it("should throw generic error when response body has no error field", async () => {
		mockFetch.mockResolvedValue(mockJsonResponse({}, false, 500));

		await expect(api.getSessions()).rejects.toThrow("Request failed");
	});

	it("should throw generic error when response body is not JSON", async () => {
		mockFetch.mockResolvedValue({
			ok: false,
			status: 500,
			json: vi.fn().mockRejectedValue(new Error("not json")),
		});

		await expect(api.getSessions()).rejects.toThrow("Request failed");
	});
});
