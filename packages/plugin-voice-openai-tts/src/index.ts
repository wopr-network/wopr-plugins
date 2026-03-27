/**
 * WOPR Voice Plugin: OpenAI TTS
 *
 * Provides TTS using OpenAI's text-to-speech API.
 * Supports gpt-4o-mini-tts (with instructions), tts-1, and tts-1-hd.
 *
 * Usage:
 * ```typescript
 * const tts = ctx.getTTS();
 * if (tts) {
 *   const { audio, format, durationMs } = await tts.synthesize("Hello world");
 * }
 * ```
 */

import type { PluginManifest } from "@wopr-network/plugin-types";
import type { WOPRPlugin, WOPRPluginContext } from "wopr";
import type {
	AudioFormat,
	TTSOptions,
	TTSProvider,
	TTSSynthesisResult,
	Voice,
	VoicePluginMetadata,
} from "wopr/voice";

// =============================================================================
// Configuration
// =============================================================================

interface OpenAITTSConfig {
	/** OpenAI API key (defaults to OPENAI_API_KEY env) */
	apiKey?: string;
	/** TTS model: gpt-4o-mini-tts (recommended), tts-1, tts-1-hd */
	model?: string;
	/** Default voice: alloy, ash, ballad, coral, echo, fable, etc. */
	voice?: string;
	/** Speed multiplier (0.25 - 4.0) */
	speed?: number;
	/** Style instructions (only gpt-4o-mini-tts) */
	instructions?: string;
}

const DEFAULT_CONFIG: Required<
	Omit<OpenAITTSConfig, "apiKey" | "instructions">
> & {
	apiKey?: string;
	instructions?: string;
} = {
	apiKey: undefined,
	model: "gpt-4o-mini-tts",
	voice: "coral",
	speed: 1.0,
	instructions: undefined,
};

// All 13 OpenAI TTS voices
const OPENAI_VOICES: Voice[] = [
	{
		id: "alloy",
		name: "Alloy",
		gender: "neutral",
		description: "Neutral, balanced",
	},
	{
		id: "ash",
		name: "Ash",
		gender: "male",
		description: "Clear, professional",
	},
	{
		id: "ballad",
		name: "Ballad",
		gender: "female",
		description: "Warm, melodic",
	},
	{
		id: "coral",
		name: "Coral",
		gender: "female",
		description: "Natural, friendly",
	},
	{
		id: "echo",
		name: "Echo",
		gender: "male",
		description: "Deep, authoritative",
	},
	{
		id: "fable",
		name: "Fable",
		gender: "neutral",
		description: "Storytelling",
	},
	{
		id: "nova",
		name: "Nova",
		gender: "female",
		description: "Energetic, youthful",
	},
	{ id: "onyx", name: "Onyx", gender: "male", description: "Deep, resonant" },
	{ id: "sage", name: "Sage", gender: "neutral", description: "Calm, wise" },
	{
		id: "shimmer",
		name: "Shimmer",
		gender: "female",
		description: "Bright, cheerful",
	},
	{
		id: "verse",
		name: "Verse",
		gender: "neutral",
		description: "Expressive, dynamic",
	},
	{
		id: "marin",
		name: "Marin",
		gender: "female",
		description: "Best quality female",
	},
	{
		id: "cedar",
		name: "Cedar",
		gender: "male",
		description: "Best quality male",
	},
];

// =============================================================================
// TTS Provider Implementation
// =============================================================================

class OpenAITTSProvider implements TTSProvider {
	readonly metadata: VoicePluginMetadata = {
		name: "openai-tts",
		version: "1.0.0",
		type: "tts",
		description: "OpenAI Text-to-Speech API",
		capabilities: ["voice-selection", "speed-control", "instructions"],
		local: false,
		emoji: "🔊",
		homepage: "https://platform.openai.com/docs/guides/text-to-speech",
		requires: {
			env: ["OPENAI_API_KEY"],
		},
		primaryEnv: "OPENAI_API_KEY",
	};

	readonly voices: Voice[] = OPENAI_VOICES;

	private apiKey: string;
	private model: string;
	private defaultVoice: string;
	private speed: number;
	private instructions?: string;

	constructor(config: OpenAITTSConfig = {}) {
		this.apiKey = config.apiKey || process.env.OPENAI_API_KEY || "";
		this.model = config.model || DEFAULT_CONFIG.model;
		this.defaultVoice = config.voice || DEFAULT_CONFIG.voice;
		this.speed = config.speed || DEFAULT_CONFIG.speed;
		this.instructions = config.instructions;
	}

	validateConfig(): void {
		if (!this.apiKey) {
			throw new Error("OPENAI_API_KEY required for OpenAI TTS");
		}

		// Validate voice
		const validVoices = OPENAI_VOICES.map((v) => v.id);
		if (!validVoices.includes(this.defaultVoice)) {
			throw new Error(
				`Invalid voice: ${this.defaultVoice}. Valid: ${validVoices.join(", ")}`,
			);
		}

		// Validate speed
		if (this.speed < 0.25 || this.speed > 4.0) {
			throw new Error(`Speed must be between 0.25 and 4.0, got: ${this.speed}`);
		}

		// Validate model
		const validModels = ["gpt-4o-mini-tts", "tts-1", "tts-1-hd"];
		if (!validModels.includes(this.model)) {
			throw new Error(
				`Invalid model: ${this.model}. Valid: ${validModels.join(", ")}`,
			);
		}
	}

	async synthesize(
		text: string,
		options?: TTSOptions,
	): Promise<TTSSynthesisResult> {
		const voice = options?.voice || this.defaultVoice;
		const speed = options?.speed || this.speed;

		// Build request body
		const body: Record<string, unknown> = {
			model: this.model,
			input: text,
			voice,
			response_format: "pcm", // Raw PCM (24kHz, mono, 16-bit signed LE)
			speed,
		};

		// Add instructions for gpt-4o-mini-tts
		const effectiveInstructions = options?.instructions || this.instructions;
		if (effectiveInstructions && this.model === "gpt-4o-mini-tts") {
			body.instructions = effectiveInstructions;
		}

		const response = await fetch("https://api.openai.com/v1/audio/speech", {
			method: "POST",
			headers: {
				Authorization: `Bearer ${this.apiKey}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify(body),
		});

		if (!response.ok) {
			const error = await response.text();
			throw new Error(`OpenAI TTS failed: ${response.status} - ${error}`);
		}

		const arrayBuffer = await response.arrayBuffer();
		const audio = Buffer.from(arrayBuffer);

		// PCM is 24kHz, 16-bit (2 bytes per sample)
		const sampleRate = 24000;
		const bytesPerSample = 2;
		const samples = audio.length / bytesPerSample;
		const durationMs = Math.round((samples / sampleRate) * 1000);

		return {
			audio,
			format: "pcm_s16le" as AudioFormat,
			sampleRate,
			durationMs,
		};
	}

	async *streamSynthesize(
		text: string,
		options?: TTSOptions,
	): AsyncGenerator<Buffer> {
		// OpenAI TTS API doesn't support true streaming, so we just yield the full result
		const result = await this.synthesize(text, options);
		yield result.audio;
	}

	async healthCheck(): Promise<boolean> {
		try {
			// Test with a tiny request
			const response = await fetch("https://api.openai.com/v1/models", {
				method: "GET",
				headers: {
					Authorization: `Bearer ${this.apiKey}`,
				},
				signal: AbortSignal.timeout(5000),
			});
			return response.ok;
		} catch {
			return false;
		}
	}
}

// =============================================================================
// Plugin Export
// =============================================================================

let provider: OpenAITTSProvider | null = null;
let pluginCtx: WOPRPluginContext | null = null;

const manifest: PluginManifest = {
	name: "@wopr-network/wopr-plugin-voice-openai-tts",
	version: "1.0.0",
	description: "OpenAI Text-to-Speech provider for WOPR",
	homepage: "https://platform.openai.com/docs/guides/text-to-speech",
	capabilities: ["tts"],
	category: "voice",
	tags: ["tts", "openai", "voice", "speech"],
	icon: "🔊",
	provides: {
		capabilities: [
			{
				type: "tts",
				id: "openai-tts",
				displayName: "OpenAI TTS",
			},
		],
	},
	configSchema: {
		title: "OpenAI TTS Configuration",
		fields: [
			{
				name: "apiKey",
				type: "password",
				label: "OpenAI API Key",
				description: "Your OpenAI API key",
				secret: true,
				required: true,
				setupFlow: "paste",
			},
			{
				name: "model",
				type: "text",
				label: "TTS Model",
				description:
					"TTS model: gpt-4o-mini-tts (recommended), tts-1, tts-1-hd",
				required: false,
				setupFlow: "none",
			},
			{
				name: "voice",
				type: "text",
				label: "Default Voice",
				description: "Default voice (alloy, ash, coral, echo, fable, etc.)",
				required: false,
				setupFlow: "none",
			},
			{
				name: "speed",
				type: "number",
				label: "Speed",
				description: "Speed multiplier (0.25 - 4.0)",
				required: false,
				setupFlow: "none",
			},
			{
				name: "instructions",
				type: "text",
				label: "Style Instructions",
				description: "Style instructions (only for gpt-4o-mini-tts)",
				required: false,
				setupFlow: "none",
			},
		],
	},
	requires: {
		env: ["OPENAI_API_KEY"],
	},
	lifecycle: {
		shutdownBehavior: "graceful",
	},
};

const plugin: WOPRPlugin = {
	name: "voice-openai-tts",
	version: "1.0.0",
	description: "OpenAI Text-to-Speech provider",
	manifest,

	async init(ctx: WOPRPluginContext) {
		pluginCtx = ctx;
		const config = ctx.getConfig<OpenAITTSConfig>();
		provider = new OpenAITTSProvider(config);

		try {
			provider.validateConfig();
			ctx.registerTTSProvider(provider);
			ctx.registerConfigSchema(
				"@wopr-network/wopr-plugin-voice-openai-tts",
				manifest.configSchema,
			);
			ctx.log.info(
				`OpenAI TTS provider registered (model: ${config.model ?? DEFAULT_CONFIG.model}, voice: ${config.voice ?? DEFAULT_CONFIG.voice})`,
			);
		} catch (err) {
			ctx.log.error(`Failed to register OpenAI TTS: ${err}`);
		}
	},

	async shutdown() {
		pluginCtx?.unregisterCapabilityProvider("tts", "openai-tts");
		pluginCtx?.unregisterConfigSchema(
			"@wopr-network/wopr-plugin-voice-openai-tts",
		);
		provider = null;
		pluginCtx = null;
	},
};

export default plugin;
