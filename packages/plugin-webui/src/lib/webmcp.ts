/**
 * WebMCP Registration Framework
 *
 * Provides a registry for plugins to register browser-side MCP tools
 * via the navigator.modelContext API. Aligned with the W3C WebMCP spec:
 * https://webmachinelearning.github.io/webmcp/
 */

// -- W3C WebMCP spec types --

/** JSON Schema object describing tool input */
export type InputSchema = Record<string, unknown>;

/** Hints about a tool's behavior */
export interface ToolAnnotations {
	readOnlyHint?: boolean;
}

/**
 * Client passed to tool execute callbacks.
 * Provides requestUserInteraction() for consent flows.
 */
export interface ModelContextClient {
	requestUserInteraction(callback: (element: Element) => Promise<unknown>): Promise<unknown>;
}

/** Callback signature for tool execution per W3C spec */
export type ToolExecuteCallback = (input: Record<string, unknown>, client: ModelContextClient) => Promise<unknown>;

/** A tool registered via navigator.modelContext.registerTool() */
export interface ModelContextTool {
	name: string;
	description: string;
	inputSchema?: InputSchema;
	execute: ToolExecuteCallback;
	annotations?: ToolAnnotations;
}

export interface AuthContext {
	userId?: string;
	sessionId?: string;
	roles?: string[];
	token?: string;
	[key: string]: unknown;
}

/** Options for provideContext() */
export interface ModelContextOptions {
	tools?: ModelContextTool[];
}

// -- Navigator type augmentation matching the WebIDL --

interface ModelContext {
	provideContext(options?: ModelContextOptions): void;
	clearContext(): void;
	registerTool(tool: ModelContextTool): void;
	unregisterTool(name: string): void;
}

function getModelContext(): ModelContext | undefined {
	const nav = globalThis.navigator as (Navigator & { modelContext?: ModelContext }) | undefined;
	if (nav?.modelContext && typeof nav.modelContext.registerTool === "function") {
		return nav.modelContext;
	}
	return undefined;
}

// -- Plugin interfaces for manifest-driven registration --

export interface WebMCPToolDeclaration {
	name: string;
	description: string;
	inputSchema?: InputSchema;
	annotations?: ToolAnnotations;
}

export interface WebMCPPlugin {
	getManifest(): { webmcpTools?: WebMCPToolDeclaration[] };
	getWebMCPHandlers?(): Record<string, ToolExecuteCallback>;
}

// -- Registry --

export class WebMCPRegistry {
	private tools: Map<string, ModelContextTool> = new Map();
	private authContext: AuthContext = {};

	/** Check whether the browser supports navigator.modelContext */
	isSupported(): boolean {
		return getModelContext() !== undefined;
	}

	/** Set the auth context that will be injected into tool execute wrappers */
	setAuthContext(auth: AuthContext): void {
		this.authContext = { ...auth };
	}

	/** Get the current auth context */
	getAuthContext(): AuthContext {
		return { ...this.authContext };
	}

	/**
	 * Register a single WebMCP tool.
	 *
	 * The user-provided execute callback receives (input, client) per the spec.
	 * Auth is available via registry.getAuthContext() inside execute callbacks.
	 */
	register(tool: ModelContextTool): void {
		const mc = getModelContext();
		if (mc) {
			mc.registerTool({
				name: tool.name,
				description: tool.description,
				inputSchema: tool.inputSchema,
				execute: (input: Record<string, unknown>, client: ModelContextClient) => tool.execute(input, client),
				annotations: tool.annotations,
			});
		}
		this.tools.set(tool.name, tool);
	}

	/** Unregister a tool by name */
	unregister(name: string): void {
		const mc = getModelContext();
		if (mc) {
			mc.unregisterTool(name);
		}
		this.tools.delete(name);
	}

	/** Get a registered tool by name */
	get(name: string): ModelContextTool | undefined {
		return this.tools.get(name);
	}

	/** List all registered tool names */
	list(): string[] {
		return Array.from(this.tools.keys());
	}

	/** Number of registered tools */
	get size(): number {
		return this.tools.size;
	}

	/** Unregister all tools */
	clear(): void {
		for (const name of this.tools.keys()) {
			const mc = getModelContext();
			if (mc) {
				mc.unregisterTool(name);
			}
		}
		this.tools.clear();
	}

	/**
	 * Register all WebMCP tools declared in a plugin's manifest.
	 * Merges manifest declarations with runtime handlers from getWebMCPHandlers().
	 */
	registerPlugin(plugin: WebMCPPlugin): void {
		const manifest = plugin.getManifest();
		const declarations = manifest.webmcpTools;
		if (!declarations || declarations.length === 0) {
			return;
		}

		const handlers = plugin.getWebMCPHandlers?.() ?? {};

		for (const decl of declarations) {
			const execute = handlers[decl.name];
			if (typeof execute !== "function") {
				continue;
			}
			this.register({
				name: decl.name,
				description: decl.description,
				inputSchema: decl.inputSchema,
				execute,
				annotations: decl.annotations,
			});
		}
	}

	/**
	 * Unregister all WebMCP tools declared in a plugin's manifest.
	 */
	unregisterPlugin(plugin: WebMCPPlugin): void {
		const manifest = plugin.getManifest();
		const declarations = manifest.webmcpTools ?? [];
		for (const decl of declarations) {
			this.unregister(decl.name);
		}
	}
}

/**
 * Wire up dynamic plugin lifecycle events to the registry.
 *
 * Listens to plugin:loaded and plugin:unloaded events on an event bus
 * and automatically registers/unregisters WebMCP tools.
 */
export function bindPluginLifecycle(
	registry: WebMCPRegistry,
	eventBus: {
		on(event: string, handler: (...args: unknown[]) => void): void;
	},
): void {
	eventBus.on("plugin:loaded", (...args: unknown[]) => {
		registry.registerPlugin(args[0] as WebMCPPlugin);
	});

	eventBus.on("plugin:unloaded", (...args: unknown[]) => {
		registry.unregisterPlugin(args[0] as WebMCPPlugin);
	});
}
