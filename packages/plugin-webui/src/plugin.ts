/**
 * WOPR Web UI Plugin
 *
 * Serves the SolidJS-based web dashboard for WOPR.
 * Built with SolidJS, TailwindCSS, and Vite.
 */

import { createReadStream, existsSync } from "node:fs";
import http from "node:http";
import { extname, join } from "node:path";
import type { ConfigSchema, PluginManifest, WOPRPlugin, WOPRPluginContext } from "@wopr-network/plugin-types";

let ctx: WOPRPluginContext | null = null;
const cleanups: Array<() => void | Promise<void>> = [];

// Content types for static files
const CONTENT_TYPES: Record<string, string> = {
	".html": "text/html",
	".js": "application/javascript",
	".css": "text/css",
	".json": "application/json",
	".svg": "image/svg+xml",
	".png": "image/png",
	".jpg": "image/jpeg",
	".ico": "image/x-icon",
	".woff": "font/woff",
	".woff2": "font/woff2",
	".ttf": "font/ttf",
};

const configSchema: ConfigSchema = {
	title: "Web UI",
	description: "Configure the local web dashboard",
	fields: [
		{
			name: "port",
			type: "number",
			label: "Port",
			placeholder: "3000",
			default: 3000,
			description: "HTTP port for the web UI server",
		},
		{
			name: "host",
			type: "text",
			label: "Host",
			placeholder: "127.0.0.1",
			default: "127.0.0.1",
			description: "Host address to bind the web UI server",
		},
	],
};

const manifest: PluginManifest = {
	name: "@wopr-network/wopr-plugin-webui",
	version: "0.2.0",
	description: "SolidJS-based local web dashboard for WOPR",
	author: "WOPR",
	license: "MIT",
	capabilities: ["webui", "dashboard"],
	category: "ui",
	tags: ["webui", "dashboard", "solidjs", "admin"],
	icon: "globe",
	requires: {
		network: { inbound: true, ports: [3000] },
	},
	provides: {
		capabilities: [
			{
				type: "webui",
				id: "wopr-webui",
				displayName: "WOPR Web Dashboard",
				tier: "wopr",
			},
		],
	},
	lifecycle: {
		healthEndpoint: "/",
		healthIntervalMs: 30000,
		shutdownBehavior: "graceful",
		shutdownTimeoutMs: 5000,
	},
	configSchema,
};

/** Start HTTP server to serve built web UI. Returns the server instance. */
function startServer(pluginDir: string, port: number, host: string): http.Server {
	const distDir = join(pluginDir, "dist");

	const httpServer = http.createServer((req, res) => {
		// Security headers
		res.setHeader("X-Content-Type-Options", "nosniff");
		res.setHeader("X-Frame-Options", "DENY");
		res.setHeader("X-XSS-Protection", "1; mode=block");

		// CORS for development
		res.setHeader("Access-Control-Allow-Origin", "*");

		// Determine file path
		let urlPath = req.url === "/" ? "/index.html" : (req.url ?? "/index.html");
		// Strip query string
		const qIdx = urlPath.indexOf("?");
		if (qIdx !== -1) urlPath = urlPath.slice(0, qIdx);

		// Handle client-side routing - serve index.html for non-file paths
		if (!extname(urlPath)) {
			urlPath = "/index.html";
		}

		const filePath = join(distDir, urlPath);

		// Security: prevent directory traversal
		if (!filePath.startsWith(distDir)) {
			res.statusCode = 403;
			res.end("Forbidden");
			return;
		}

		// Check if file exists
		if (!existsSync(filePath)) {
			// Serve index.html for client-side routing
			const indexPath = join(distDir, "index.html");
			if (existsSync(indexPath)) {
				res.setHeader("Content-Type", "text/html");
				createReadStream(indexPath).pipe(res);
				return;
			}
			res.statusCode = 404;
			res.end("Not found");
			return;
		}

		// Serve file
		const ext = extname(filePath).toLowerCase();
		const contentType = CONTENT_TYPES[ext] || "application/octet-stream";
		res.setHeader("Content-Type", contentType);

		createReadStream(filePath).pipe(res);
	});

	httpServer.on("error", (err) => {
		ctx?.log?.error("webui server error", { err });
	});
	httpServer.listen(port, host);
	return httpServer;
}

const plugin: WOPRPlugin = {
	name: "wopr-plugin-webui",
	version: "0.2.0",
	description: "Web UI dashboard for WOPR",
	manifest,

	async init(pluginContext: WOPRPluginContext) {
		if (ctx !== null) return;
		ctx = pluginContext;

		// Register config schema
		ctx.registerConfigSchema("wopr-plugin-webui", configSchema);
		cleanups.push(() => {
			ctx?.unregisterConfigSchema("wopr-plugin-webui");
		});

		const config = ctx.getConfig<{ port?: number; host?: string }>();
		const port = config?.port || 3000;
		const host = config?.host || "127.0.0.1";

		// Check if dist folder exists
		const distDir = join(ctx.getPluginDir(), "dist");
		if (!existsSync(distDir)) {
			ctx.log.error("dist/ folder not found. Run 'npm run build:ui' first.");
			ctx.log.info("The Web UI needs to be built before it can be served.");
			// Clean up what we registered before bailing
			ctx.unregisterConfigSchema("wopr-plugin-webui");
			cleanups.length = 0;
			ctx = null;
			return;
		}

		// Start server
		const server = startServer(ctx.getPluginDir(), port, host);
		cleanups.push(
			() =>
				new Promise<void>((resolve, reject) => {
					server.close((err) => (err ? reject(err) : resolve()));
				}),
		);

		ctx.log.info(`Web UI server running at http://${host}:${port}`);

		// Register as the main web UI
		ctx.registerWebUiExtension({
			id: "main",
			title: "Web Dashboard",
			url: `http://${host}:${port}`,
			description: "WOPR web interface",
			category: "core",
		});
		cleanups.push(() => {
			ctx?.unregisterWebUiExtension("main");
		});

		ctx.log.info("Registered Web UI extension");
		ctx.log.info("Make sure the WOPR daemon API is accessible from the browser");
	},

	async shutdown() {
		// Run cleanups in reverse order (LIFO)
		for (let i = cleanups.length - 1; i >= 0; i--) {
			try {
				await cleanups[i]();
			} catch (error: unknown) {
				ctx?.log.error(`Cleanup error: ${error instanceof Error ? error.message : String(error)}`);
			}
		}
		cleanups.length = 0;
		ctx = null;
	},
};

export default plugin;
