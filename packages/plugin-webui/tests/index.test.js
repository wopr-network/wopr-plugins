import http from "node:http";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs", () => ({
	existsSync: vi.fn(() => true),
	createReadStream: vi.fn(() => ({
		pipe: vi.fn(),
	})),
}));

function createMockContext(overrides = {}) {
	return {
		getPluginDir: vi.fn(() => "/fake/plugin/dir"),
		getConfig: vi.fn(() => ({})),
		log: {
			info: vi.fn(),
			error: vi.fn(),
			warn: vi.fn(),
			debug: vi.fn(),
		},
		registerConfigSchema: vi.fn(),
		unregisterConfigSchema: vi.fn(),
		registerWebUiExtension: vi.fn(),
		unregisterWebUiExtension: vi.fn(),
		...overrides,
	};
}

// We need to get a fresh plugin for each test since it has module-level state
async function loadPlugin() {
	vi.resetModules();
	vi.doMock("node:fs", () => ({
		existsSync: vi.fn(() => true),
		createReadStream: vi.fn(() => ({
			pipe: vi.fn(),
		})),
	}));
	const mod = await import("../src/plugin.js");
	return mod.default;
}

describe("webui plugin metadata", () => {
	let plugin;

	beforeEach(async () => {
		plugin = await loadPlugin();
	});

	it("should have correct name", () => {
		expect(plugin.name).toBe("wopr-plugin-webui");
	});

	it("should have correct version", () => {
		expect(plugin.version).toBe("0.2.0");
	});

	it("should have a description", () => {
		expect(plugin.description).toBe("Web UI dashboard for WOPR");
	});

	it("should export init and shutdown functions", () => {
		expect(typeof plugin.init).toBe("function");
		expect(typeof plugin.shutdown).toBe("function");
	});
});

describe("webui plugin init", () => {
	let plugin;
	let mockServer;
	let fsMock;

	beforeEach(async () => {
		mockServer = {
			listen: vi.fn(),
			close: vi.fn((cb) => cb()),
			on: vi.fn(),
		};
		vi.spyOn(http, "createServer").mockReturnValue(mockServer);

		plugin = await loadPlugin();
		fsMock = await import("node:fs");
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("should use default port 3000 and host 127.0.0.1 when no config", async () => {
		const ctx = createMockContext();
		fsMock.existsSync.mockReturnValue(true);

		await plugin.init(ctx);

		expect(mockServer.listen).toHaveBeenCalledWith(3000, "127.0.0.1");
	});

	it("should use configured port and host", async () => {
		const ctx = createMockContext({
			getConfig: vi.fn(() => ({ port: 8080, host: "0.0.0.0" })),
		});
		fsMock.existsSync.mockReturnValue(true);

		await plugin.init(ctx);

		expect(mockServer.listen).toHaveBeenCalledWith(8080, "0.0.0.0");
	});

	it("should log error and return early if dist/ does not exist", async () => {
		const ctx = createMockContext();
		fsMock.existsSync.mockReturnValue(false);

		await plugin.init(ctx);

		expect(ctx.log.error).toHaveBeenCalledWith(expect.stringContaining("dist/ folder not found"));
		expect(http.createServer).not.toHaveBeenCalled();
	});

	it("should register web UI extension when registerWebUiExtension is available", async () => {
		const ctx = createMockContext();
		fsMock.existsSync.mockReturnValue(true);

		await plugin.init(ctx);

		expect(ctx.registerWebUiExtension).toHaveBeenCalledWith({
			id: "main",
			title: "Web Dashboard",
			url: "http://127.0.0.1:3000",
			description: "WOPR web interface",
			category: "core",
		});
	});

	it("should log the URL after starting", async () => {
		const ctx = createMockContext();
		fsMock.existsSync.mockReturnValue(true);

		await plugin.init(ctx);

		expect(ctx.log.info).toHaveBeenCalledWith("Web UI server running at http://127.0.0.1:3000");
	});
});

describe("webui plugin shutdown", () => {
	let plugin;
	let mockServer;
	let fsMock;

	beforeEach(async () => {
		mockServer = {
			listen: vi.fn(),
			close: vi.fn((cb) => cb()),
			on: vi.fn(),
		};
		vi.spyOn(http, "createServer").mockReturnValue(mockServer);

		plugin = await loadPlugin();
		fsMock = await import("node:fs");
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("should close the server on shutdown", async () => {
		const ctx = createMockContext();
		fsMock.existsSync.mockReturnValue(true);

		await plugin.init(ctx);
		await plugin.shutdown();

		expect(mockServer.close).toHaveBeenCalled();
	});

	it("should do nothing if no server is running", async () => {
		// Don't call init, so server is null
		await plugin.shutdown();
		// Should not throw
	});

	it("should log error if server.close errors", async () => {
		const ctx = createMockContext();
		fsMock.existsSync.mockReturnValue(true);

		await plugin.init(ctx);
		mockServer.close.mockImplementation((cb) => cb(new Error("close error")));

		// shutdown swallows cleanup errors and logs them
		await plugin.shutdown();
		expect(ctx.log.error).toHaveBeenCalledWith(expect.stringContaining("close error"));
	});
});

describe("HTTP server request handling", () => {
	let plugin;
	let requestHandler;
	let mockRes;
	let fsMock;

	beforeEach(async () => {
		vi.spyOn(http, "createServer").mockImplementation((handler) => {
			requestHandler = handler;
			return {
				listen: vi.fn(),
				close: vi.fn((cb) => cb()),
				on: vi.fn(),
			};
		});

		plugin = await loadPlugin();
		fsMock = await import("node:fs");

		mockRes = {
			setHeader: vi.fn(),
			end: vi.fn(),
			statusCode: 200,
		};

		const ctx = createMockContext();
		fsMock.existsSync.mockReturnValue(true);
		await plugin.init(ctx);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("should set security headers on every response", () => {
		fsMock.existsSync.mockReturnValue(true);
		fsMock.createReadStream.mockReturnValue({ pipe: vi.fn() });

		requestHandler({ url: "/" }, mockRes);

		expect(mockRes.setHeader).toHaveBeenCalledWith("X-Content-Type-Options", "nosniff");
		expect(mockRes.setHeader).toHaveBeenCalledWith("X-Frame-Options", "DENY");
		expect(mockRes.setHeader).toHaveBeenCalledWith("X-XSS-Protection", "1; mode=block");
		expect(mockRes.setHeader).toHaveBeenCalledWith("Access-Control-Allow-Origin", "*");
	});

	it("should serve index.html for root path /", () => {
		fsMock.existsSync.mockReturnValue(true);
		const mockPipe = vi.fn();
		fsMock.createReadStream.mockReturnValue({ pipe: mockPipe });

		requestHandler({ url: "/" }, mockRes);

		expect(mockRes.setHeader).toHaveBeenCalledWith("Content-Type", "text/html");
		expect(mockPipe).toHaveBeenCalledWith(mockRes);
	});

	it("should serve correct content-type for .js files", () => {
		fsMock.existsSync.mockReturnValue(true);
		const mockPipe = vi.fn();
		fsMock.createReadStream.mockReturnValue({ pipe: mockPipe });

		requestHandler({ url: "/assets/app.js" }, mockRes);

		expect(mockRes.setHeader).toHaveBeenCalledWith("Content-Type", "application/javascript");
	});

	it("should serve correct content-type for .css files", () => {
		fsMock.existsSync.mockReturnValue(true);
		const mockPipe = vi.fn();
		fsMock.createReadStream.mockReturnValue({ pipe: mockPipe });

		requestHandler({ url: "/assets/style.css" }, mockRes);

		expect(mockRes.setHeader).toHaveBeenCalledWith("Content-Type", "text/css");
	});

	it("should serve correct content-type for .svg files", () => {
		fsMock.existsSync.mockReturnValue(true);
		const mockPipe = vi.fn();
		fsMock.createReadStream.mockReturnValue({ pipe: mockPipe });

		requestHandler({ url: "/icon.svg" }, mockRes);

		expect(mockRes.setHeader).toHaveBeenCalledWith("Content-Type", "image/svg+xml");
	});

	it("should serve correct content-type for .json files", () => {
		fsMock.existsSync.mockReturnValue(true);
		const mockPipe = vi.fn();
		fsMock.createReadStream.mockReturnValue({ pipe: mockPipe });

		requestHandler({ url: "/manifest.json" }, mockRes);

		expect(mockRes.setHeader).toHaveBeenCalledWith("Content-Type", "application/json");
	});

	it("should serve correct content-type for .png files", () => {
		fsMock.existsSync.mockReturnValue(true);
		const mockPipe = vi.fn();
		fsMock.createReadStream.mockReturnValue({ pipe: mockPipe });

		requestHandler({ url: "/logo.png" }, mockRes);

		expect(mockRes.setHeader).toHaveBeenCalledWith("Content-Type", "image/png");
	});

	it("should use application/octet-stream for unknown extensions", () => {
		fsMock.existsSync.mockReturnValue(true);
		const mockPipe = vi.fn();
		fsMock.createReadStream.mockReturnValue({ pipe: mockPipe });

		requestHandler({ url: "/data.xyz" }, mockRes);

		expect(mockRes.setHeader).toHaveBeenCalledWith("Content-Type", "application/octet-stream");
	});

	it("should serve index.html for paths without extension (client-side routing)", () => {
		fsMock.existsSync.mockReturnValue(true);
		const mockPipe = vi.fn();
		fsMock.createReadStream.mockReturnValue({ pipe: mockPipe });

		requestHandler({ url: "/settings" }, mockRes);

		// Non-extension paths should map to /index.html
		expect(mockRes.setHeader).toHaveBeenCalledWith("Content-Type", "text/html");
	});

	it("should return 404 when file does not exist and no index.html fallback", () => {
		fsMock.existsSync.mockReturnValue(false);

		requestHandler({ url: "/missing.js" }, mockRes);

		expect(mockRes.statusCode).toBe(404);
		expect(mockRes.end).toHaveBeenCalledWith("Not found");
	});

	it("should fallback to index.html when file is missing but index.html exists", () => {
		const distDir = join("/fake/plugin/dir", "dist");
		const indexPath = join(distDir, "index.html");

		fsMock.existsSync.mockImplementation((path) => path === indexPath);
		const mockPipe = vi.fn();
		fsMock.createReadStream.mockReturnValue({ pipe: mockPipe });

		requestHandler({ url: "/nonexistent.js" }, mockRes);

		expect(mockRes.setHeader).toHaveBeenCalledWith("Content-Type", "text/html");
		expect(mockPipe).toHaveBeenCalledWith(mockRes);
	});

	it("should return 403 for directory traversal attempts", () => {
		fsMock.existsSync.mockReturnValue(true);

		// URL must have an extension so it won't be rewritten to /index.html
		requestHandler({ url: "/../../../etc/shadow.txt" }, mockRes);

		expect(mockRes.statusCode).toBe(403);
		expect(mockRes.end).toHaveBeenCalledWith("Forbidden");
	});
});
