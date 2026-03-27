import type {
	ConfigSchema,
	WOPRPlugin,
	WOPRPluginContext,
} from "@wopr-network/plugin-types";
import { PiperTTSProvider } from "./piper-provider.js";
import type { PiperTTSConfig } from "./types.js";

let ctx: WOPRPluginContext | null = null;
let provider: PiperTTSProvider | null = null;
const cleanups: Array<() => void | Promise<void>> = [];

const configSchema: ConfigSchema = {
	title: "Piper TTS Configuration",
	description: "Local TTS using Piper in Docker",
	fields: [
		{
			name: "image",
			type: "text",
			label: "Docker Image",
			default: "rhasspy/piper:latest",
			description: "Docker image to use for Piper TTS",
			setupFlow: "none",
		},
		{
			name: "voice",
			type: "text",
			label: "Default Voice",
			default: "en_US-lessac-medium",
			description: "Default voice model ID",
			setupFlow: "none",
		},
		{
			name: "sampleRate",
			type: "number",
			label: "Sample Rate (Hz)",
			default: 22050,
			description: "Audio sample rate: 16000, 22050, 24000, or 48000",
			setupFlow: "none",
		},
		{
			name: "speed",
			type: "number",
			label: "Speed",
			default: 1.0,
			description: "Speed multiplier (0.5–2.0)",
			setupFlow: "none",
		},
		{
			name: "modelCachePath",
			type: "text",
			label: "Model Cache Directory",
			description: "Host path to cache downloaded voice models (optional)",
		},
	],
};

const manifest = {
	name: "voice-piper-tts",
	version: "1.0.0",
	description: "Local TTS using Piper in Docker",
	capabilities: ["tts"] as string[],
	category: "voice" as const,
	tags: ["tts", "voice", "piper", "local", "docker", "offline"],
	icon: "🔊",
	requires: {
		docker: ["rhasspy/piper:latest"],
	},
	provides: {
		capabilities: [
			{
				type: "tts",
				id: "piper-tts",
				displayName: "Piper TTS (Local Docker)",
				tier: "wopr" as const,
				configSchema,
			},
		],
	},
	lifecycle: {
		shutdownBehavior: "graceful" as const,
	},
	configSchema,
};

const piperPlugin: WOPRPlugin = {
	name: manifest.name,
	version: manifest.version,
	description: manifest.description,
	manifest,

	async init(pluginCtx: WOPRPluginContext) {
		ctx = pluginCtx;
		const config = ctx.getConfig<PiperTTSConfig>();
		provider = new PiperTTSProvider(config);

		try {
			provider.validateConfig();
		} catch (error: unknown) {
			ctx.log.error(
				`Invalid Piper TTS config: ${error instanceof Error ? error.message : String(error)}`,
			);
			return;
		}

		// Register TTS provider
		ctx.registerProvider(provider);
		cleanups.push(() => {
			ctx?.unregisterProvider?.("piper-tts");
		});
		// Register via extension API for channel plugins consuming via getExtension("tts")
		ctx.registerExtension("tts", provider);
		cleanups.push(() => {
			ctx?.unregisterExtension?.("tts");
		});

		// Register config schema
		if (ctx.registerConfigSchema) {
			ctx.registerConfigSchema("voice-piper-tts", configSchema);
			cleanups.push(() => {
				ctx?.unregisterConfigSchema?.("voice-piper-tts");
			});
		}

		// Register A2A synthesize tool (guarded)
		if (ctx.registerA2AServer) {
			ctx.registerA2AServer({
				name: "piper-tts",
				tools: [
					{
						name: "synthesize",
						description: "Convert text to speech audio",
						inputSchema: {
							type: "object",
							properties: {
								text: { type: "string", description: "Text to synthesize" },
								voice: {
									type: "string",
									description: "Voice model ID (optional)",
								},
								speed: {
									type: "number",
									description: "Speed 0.5–2.0 (optional)",
								},
							},
							required: ["text"],
						},
						handler: async (args: Record<string, unknown>) => {
							const text = args.text as string;
							const voice = args.voice as string | undefined;
							const speed = args.speed as number | undefined;
							if (!provider) {
								return {
									content: [
										{
											type: "text" as const,
											text: "TTS provider not initialized",
										},
									],
								};
							}
							try {
								const result = await provider.synthesize(text, {
									voice,
									speed,
								});
								return {
									content: [
										{
											type: "text" as const,
											text: JSON.stringify({
												format: result.format,
												sampleRate: result.sampleRate,
												durationMs: result.durationMs,
												audioBytes: result.audio.length,
											}),
										},
									],
								};
							} catch (error: unknown) {
								return {
									content: [
										{
											type: "text" as const,
											text: `Synthesis failed: ${error instanceof Error ? error.message : String(error)}`,
										},
									],
								};
							}
						},
					},
				],
			});
		}

		ctx.log.info("Piper TTS provider registered");
	},

	async shutdown() {
		// Reverse all registrations
		for (const cleanup of [...cleanups].reverse()) {
			try {
				await cleanup();
			} catch (_error: unknown) {
				// Best-effort cleanup
			}
		}
		cleanups.length = 0;

		if (provider) {
			await provider.shutdown();
			provider = null;
		}
		ctx = null;
	},
};

export default piperPlugin;
