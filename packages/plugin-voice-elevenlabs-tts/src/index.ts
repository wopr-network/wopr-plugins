/**
 * ElevenLabs TTS Provider for WOPR
 *
 * Implements the WOPR TTSProvider interface using ElevenLabs streaming API.
 * Based on clawdbot PR 1154 talk mode implementation.
 */

import { createHash } from "node:crypto";
import type {
	PluginManifest,
	WOPRPlugin,
	WOPRPluginContext,
} from "@wopr-network/plugin-types";
import fetch from "node-fetch";
import type {
	AudioFormat,
	ElevenLabsConfig,
	ElevenLabsTTSOptions,
	ElevenLabsTTSRequest,
	ElevenLabsVoicesResponse,
	TTSOptions,
	TTSProvider,
	TTSSynthesisResult,
	Voice,
	VoiceDirective,
	VoicePluginMetadata,
} from "./types.js";
import { getWebMCPHandlers, getWebMCPToolDeclarations } from "./webmcp.js";

let ctx: WOPRPluginContext | null = null;
const cleanups: Array<() => void> = [];

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Validate stability parameter based on model.
 * eleven_v3 only supports 0.0, 0.5, 1.0; others accept 0..1 range.
 */
function validateStability(
	value: number | undefined,
	modelId?: string,
): number | undefined {
	if (value === undefined) return undefined;
	if (modelId === "eleven_v3") {
		const valid = [0.0, 0.5, 1.0];
		const closest = valid.reduce((prev, curr) =>
			Math.abs(curr - value) < Math.abs(prev - value) ? curr : prev,
		);
		return closest;
	}
	return Math.max(0, Math.min(1, value));
}

/**
 * Validate unit range (0..1) for similarity_boost, style parameters.
 */
function validateUnit(value: number | undefined): number | undefined {
	if (value === undefined) return undefined;
	return Math.max(0, Math.min(1, value));
}

/**
 * Validate seed (must be integer between 0 and 4294967295).
 */
function validateSeed(value: number | undefined): number | undefined {
	if (value === undefined) return undefined;
	return Math.max(0, Math.min(4294967295, Math.floor(value)));
}

/**
 * Validate latency tier (0..4).
 */
function validateLatencyTier(value: number | undefined): number | undefined {
	if (value === undefined) return undefined;
	return Math.max(0, Math.min(4, Math.floor(value)));
}

/**
 * Resolve speed parameter from either speed multiplier or rate (WPM).
 * Speed is a multiplier (0.5 - 2.0), rate is words-per-minute.
 */
function resolveSpeed(speed?: number, rateWPM?: number): number | undefined {
	if (speed !== undefined) {
		return Math.max(0.25, Math.min(4.0, speed));
	}
	if (rateWPM !== undefined) {
		// Average speaking rate is ~150 WPM
		const baseWPM = 150;
		return Math.max(0.25, Math.min(4.0, rateWPM / baseWPM));
	}
	return undefined;
}

/**
 * Map WOPR AudioFormat to ElevenLabs output_format.
 */
function mapAudioFormat(format?: AudioFormat): string {
	if (!format) return "pcm_44100";

	switch (format) {
		case "pcm_s16le":
			return "pcm_44100";
		case "mp3":
			return "mp3_44100_128";
		case "opus":
		case "ogg_opus":
			return "ulaw_8000"; // ElevenLabs doesn't support Opus directly
		default:
			return "pcm_44100";
	}
}

/**
 * Parse ElevenLabs output format string to extract sample rate.
 */
function parseSampleRate(format: string): number {
	const match = format.match(/(\d+)/);
	return match ? parseInt(match[1], 10) : 44100;
}

/**
 * Parse voice directive from text (first line JSON).
 * Returns { directive, stripped, unknownKeys }.
 */
function parseVoiceDirective(text: string): {
	directive: VoiceDirective | null;
	stripped: string;
	unknownKeys: string[];
} {
	const lines = text.split("\n");
	const firstLine = lines[0]?.trim() || "";

	if (!firstLine.startsWith("{") || !firstLine.endsWith("}")) {
		return { directive: null, stripped: text, unknownKeys: [] };
	}

	try {
		const parsed = JSON.parse(firstLine) as Record<string, unknown>;
		const knownKeys = new Set([
			"voice",
			"voice_id",
			"voiceId",
			"model",
			"model_id",
			"modelId",
			"speed",
			"rate",
			"stability",
			"similarity",
			"style",
			"speakerBoost",
			"seed",
			"normalize",
			"lang",
			"language",
			"output_format",
			"outputFormat",
			"latency_tier",
			"once",
		]);

		const unknownKeys = Object.keys(parsed).filter((k) => !knownKeys.has(k));
		const directive = parsed as VoiceDirective;
		const stripped = lines.slice(1).join("\n");

		return { directive, stripped, unknownKeys };
	} catch {
		return { directive: null, stripped: text, unknownKeys: [] };
	}
}

/**
 * Merge TTSOptions with ElevenLabs-specific options.
 */
function mergeOptions(
	base: TTSOptions | undefined,
	extended: ElevenLabsTTSOptions | undefined,
): ElevenLabsTTSOptions {
	return {
		voice: extended?.voice || base?.voice,
		speed: extended?.speed || base?.speed,
		rate: extended?.rate,
		stability: extended?.stability,
		similarity: extended?.similarity || extended?.similarityBoost,
		style: extended?.style,
		speakerBoost: extended?.speakerBoost,
		seed: extended?.seed,
		modelId: extended?.modelId,
		outputFormat: extended?.outputFormat,
		language: extended?.language,
		latencyTier: extended?.latencyTier,
	};
}

// =============================================================================
// ElevenLabs TTS Provider
// =============================================================================

export class ElevenLabsTTSProvider implements TTSProvider {
	readonly metadata: VoicePluginMetadata = {
		name: "elevenlabs",
		version: "1.0.0",
		type: "tts",
		description:
			"ElevenLabs high-quality text-to-speech with streaming support",
		capabilities: [
			"streaming",
			"voice-selection",
			"voice-parameters",
			"voice-cloning",
		],
		local: false,
		requires: {
			env: ["ELEVENLABS_API_KEY"],
		},
		install: [
			{
				kind: "manual",
				instructions: "Sign up at https://elevenlabs.io and get your API key",
				label: "Get ElevenLabs API key",
			},
		],
		primaryEnv: "ELEVENLABS_API_KEY",
		emoji: "🔊",
		homepage: "https://elevenlabs.io",
	};

	private config: ElevenLabsConfig;
	private cachedVoices: Voice[] = [];
	private voicesCachedAt: number = 0;
	private readonly VOICE_CACHE_TTL = 3600000; // 1 hour
	private readonly BASE_URL = "https://api.elevenlabs.io/v1";
	/**
	 * In-memory LRU cache of cloned voice IDs keyed by SHA-256 hash of the
	 * reference audio buffer. Bounded to 50 entries to stay within ElevenLabs
	 * voice count limits.
	 *
	 * NOTE: This cache is intentionally not persisted via context.storage. Cloned
	 * voices are ephemeral synthesis aids, not durable application state. Persisting
	 * them would require a schema migration and introduce storage coupling for
	 * data that is cheap to recreate. Voices evicted from this cache (or lost on
	 * restart) are deleted from ElevenLabs to avoid account voice-count exhaustion.
	 */
	private clonedVoiceCache = new Map<string, string>();
	logger?: import("@wopr-network/plugin-types").PluginLogger;

	constructor(config: Partial<ElevenLabsConfig>) {
		const apiKey = config.apiKey || process.env.ELEVENLABS_API_KEY || "";
		if (!apiKey) {
			throw new Error("ELEVENLABS_API_KEY is required");
		}

		this.config = {
			apiKey,
			defaultVoiceId: config.defaultVoiceId,
			defaultModelId: config.defaultModelId || "eleven_turbo_v2_5",
			stability: config.stability ?? 0.5,
			similarityBoost: config.similarityBoost ?? 0.75,
			style: config.style,
			speakerBoost: config.speakerBoost ?? true,
		};
	}

	get voices(): Voice[] {
		return this.cachedVoices;
	}

	get currentModelId(): string {
		return this.config.defaultModelId || "eleven_turbo_v2_5";
	}

	validateConfig(): void {
		if (!this.config.apiKey) {
			throw new Error("ELEVENLABS_API_KEY is required");
		}
	}

	/**
	 * Fetch available voices from ElevenLabs API.
	 */
	async fetchVoices(): Promise<Voice[]> {
		const now = Date.now();
		if (
			this.cachedVoices.length > 0 &&
			now - this.voicesCachedAt < this.VOICE_CACHE_TTL
		) {
			return this.cachedVoices;
		}

		const response = await fetch(`${this.BASE_URL}/voices`, {
			headers: {
				"xi-api-key": this.config.apiKey,
			},
		});

		if (!response.ok) {
			throw new Error(`Failed to fetch voices: ${response.statusText}`);
		}

		const data = (await response.json()) as ElevenLabsVoicesResponse;

		this.cachedVoices = data.voices.map((v) => ({
			id: v.voice_id,
			name: v.name,
			language: v.labels?.language,
			gender: v.labels?.gender as "male" | "female" | "neutral" | undefined,
			description: v.description,
		}));

		this.voicesCachedAt = now;
		return this.cachedVoices;
	}

	/**
	 * Create an instant cloned voice from a reference audio sample.
	 * Caches the resulting voice_id keyed by a simple hash of the audio buffer.
	 */
	private async getOrCreateClonedVoice(
		referenceAudio: Buffer,
	): Promise<string> {
		// SHA-256 of full buffer as cache key to avoid collision on identical WAV headers
		const hashKey = createHash("sha256").update(referenceAudio).digest("hex");

		const cached = this.clonedVoiceCache.get(hashKey);
		if (cached) return cached;

		// ElevenLabs instant voice clone: POST /v1/voices/add
		const formData = new FormData();
		formData.append("name", `wopr-clone-${Date.now()}`);
		const audioArrayBuffer = new ArrayBuffer(referenceAudio.byteLength);
		new Uint8Array(audioArrayBuffer).set(referenceAudio);
		formData.append(
			"files",
			new Blob([audioArrayBuffer], { type: "audio/wav" }),
			"reference.wav",
		);

		const response = await fetch(`${this.BASE_URL}/voices/add`, {
			method: "POST",
			headers: {
				"xi-api-key": this.config.apiKey,
			},
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			body: formData as any,
		});

		if (!response.ok) {
			const error = await response.text();
			throw new Error(
				`ElevenLabs voice cloning failed: ${response.statusText} - ${error}`,
			);
		}

		const data = (await response.json()) as { voice_id: string };
		// Evict oldest entry if cache has reached cap of 50; delete from ElevenLabs
		// to avoid account voice-count exhaustion.
		if (this.clonedVoiceCache.size >= 50) {
			const oldestKey = this.clonedVoiceCache.keys().next().value;
			if (oldestKey !== undefined) {
				const evictedVoiceId = this.clonedVoiceCache.get(oldestKey);
				this.clonedVoiceCache.delete(oldestKey);
				if (evictedVoiceId) {
					this.deleteClonedVoice(evictedVoiceId).catch((err: Error) => {
						this.logger?.warn(
							`[ElevenLabs] Failed to delete evicted cloned voice ${evictedVoiceId}: ${err.message}`,
						);
					});
				}
			}
		}
		this.clonedVoiceCache.set(hashKey, data.voice_id);
		return data.voice_id;
	}

	/**
	 * Delete a cloned voice from the ElevenLabs account.
	 * Called on LRU eviction and on plugin shutdown to avoid voice-count exhaustion.
	 */
	private async deleteClonedVoice(voiceId: string): Promise<void> {
		const response = await fetch(`${this.BASE_URL}/voices/${voiceId}`, {
			method: "DELETE",
			headers: {
				"xi-api-key": this.config.apiKey,
			},
		});
		if (!response.ok) {
			const error = await response.text();
			throw new Error(
				`ElevenLabs voice delete failed: ${response.statusText} - ${error}`,
			);
		}
	}

	async synthesize(
		text: string,
		options?: TTSOptions,
	): Promise<TTSSynthesisResult> {
		// Parse voice directive if present
		const { directive, stripped, unknownKeys } = parseVoiceDirective(text);
		const cleanText = stripped || text;

		if (unknownKeys.length > 0) {
			ctx?.log.warn(
				`[ElevenLabs] Unknown directive keys: ${unknownKeys.join(", ")}`,
			);
		}

		// Merge options with directive
		const opts = mergeOptions(options, {
			voice: directive?.voiceId || directive?.voice_id || directive?.voice,
			speed: directive?.speed,
			rate: directive?.rate,
			stability: directive?.stability,
			similarity: directive?.similarity,
			style: directive?.style,
			speakerBoost: directive?.speakerBoost,
			seed: directive?.seed,
			modelId: directive?.modelId || directive?.model_id || directive?.model,
			outputFormat: directive?.outputFormat || directive?.output_format,
			language: directive?.lang || directive?.language,
			latencyTier: directive?.latency_tier,
		} as ElevenLabsTTSOptions);

		// If referenceAudio provided, create/get cloned voice and use its ID
		const extOpts = options as ElevenLabsTTSOptions | undefined;
		if (extOpts?.referenceAudio) {
			const clonedVoiceId = await this.getOrCreateClonedVoice(
				extOpts.referenceAudio,
			);
			opts.voice = clonedVoiceId;
		}

		const voiceId = opts.voice || this.config.defaultVoiceId;
		if (!voiceId) {
			throw new Error("Voice ID is required");
		}

		const modelId =
			opts.modelId || this.config.defaultModelId || "eleven_turbo_v2_5";
		const outputFormat = opts.outputFormat || mapAudioFormat(options?.format);
		const sampleRate = options?.sampleRate || parseSampleRate(outputFormat);

		const requestBody: ElevenLabsTTSRequest = {
			text: cleanText,
			model_id: modelId,
			voice_settings: {
				stability: validateStability(
					opts.stability ?? this.config.stability,
					modelId,
				),
				similarity_boost: validateUnit(
					opts.similarity ?? this.config.similarityBoost,
				),
				style: validateUnit(opts.style ?? this.config.style),
				use_speaker_boost: opts.speakerBoost ?? this.config.speakerBoost,
			},
			seed: validateSeed(opts.seed),
			language_code: opts.language,
		};

		const queryParams = new URLSearchParams({ output_format: outputFormat });
		if (opts.latencyTier !== undefined) {
			queryParams.set(
				"optimize_streaming_latency",
				String(validateLatencyTier(opts.latencyTier)),
			);
		}

		const url = `${this.BASE_URL}/text-to-speech/${voiceId}?${queryParams}`;
		const response = await fetch(url, {
			method: "POST",
			headers: {
				"xi-api-key": this.config.apiKey,
				"Content-Type": "application/json",
			},
			body: JSON.stringify(requestBody),
		});

		if (!response.ok) {
			const error = await response.text();
			throw new Error(
				`ElevenLabs TTS failed: ${response.statusText} - ${error}`,
			);
		}

		const arrayBuffer = await response.arrayBuffer();
		const audio = Buffer.from(arrayBuffer);

		// Estimate duration (rough calculation based on text length)
		// Average speaking rate: ~150 words/min = ~2.5 words/sec
		const words = cleanText.split(/\s+/).length;
		const speedMultiplier = opts.speed || 1.0;
		const durationMs = ((words / 2.5) * 1000) / speedMultiplier;

		return {
			audio,
			format: options?.format || "pcm_s16le",
			sampleRate,
			durationMs,
		};
	}

	/**
	 * Stream TTS synthesis for long text with low latency.
	 */
	async *streamSynthesize(
		text: string,
		options?: TTSOptions,
	): AsyncGenerator<Buffer> {
		// Parse voice directive if present
		const { directive, stripped, unknownKeys } = parseVoiceDirective(text);
		const cleanText = stripped || text;

		if (unknownKeys.length > 0) {
			ctx?.log.warn(
				`[ElevenLabs] Unknown directive keys: ${unknownKeys.join(", ")}`,
			);
		}

		// Merge options with directive
		const opts = mergeOptions(options, {
			voice: directive?.voiceId || directive?.voice_id || directive?.voice,
			speed: directive?.speed,
			rate: directive?.rate,
			stability: directive?.stability,
			similarity: directive?.similarity,
			style: directive?.style,
			speakerBoost: directive?.speakerBoost,
			seed: directive?.seed,
			modelId: directive?.modelId || directive?.model_id || directive?.model,
			outputFormat: directive?.outputFormat || directive?.output_format,
			language: directive?.lang || directive?.language,
			latencyTier: directive?.latency_tier,
		} as ElevenLabsTTSOptions);

		const voiceId = opts.voice || this.config.defaultVoiceId;
		if (!voiceId) {
			throw new Error("Voice ID is required");
		}

		const modelId =
			opts.modelId || this.config.defaultModelId || "eleven_turbo_v2_5";
		const outputFormat = opts.outputFormat || mapAudioFormat(options?.format);
		const speed = resolveSpeed(opts.speed, opts.rate);

		const requestBody: ElevenLabsTTSRequest = {
			text: cleanText,
			model_id: modelId,
			voice_settings: {
				stability: validateStability(
					opts.stability ?? this.config.stability,
					modelId,
				),
				similarity_boost: validateUnit(
					opts.similarity ?? this.config.similarityBoost,
				),
				style: validateUnit(opts.style ?? this.config.style),
				use_speaker_boost: opts.speakerBoost ?? this.config.speakerBoost,
			},
			seed: validateSeed(opts.seed),
			language_code: opts.language,
			speed,
		};

		const queryParams = new URLSearchParams({ output_format: outputFormat });

		// Optimize streaming latency
		if (opts.latencyTier !== undefined) {
			queryParams.set(
				"optimize_streaming_latency",
				String(validateLatencyTier(opts.latencyTier)),
			);
		} else {
			queryParams.set("optimize_streaming_latency", "0"); // Default to lowest latency for streaming
		}

		const url = `${this.BASE_URL}/text-to-speech/${voiceId}/stream?${queryParams}`;
		const response = await fetch(url, {
			method: "POST",
			headers: {
				"xi-api-key": this.config.apiKey,
				"Content-Type": "application/json",
			},
			body: JSON.stringify(requestBody),
		});

		if (!response.ok) {
			const error = await response.text();
			throw new Error(
				`ElevenLabs TTS streaming failed: ${response.statusText} - ${error}`,
			);
		}

		if (!response.body) {
			throw new Error("Response body is null");
		}

		// Stream audio chunks from node-fetch ReadableStream
		for await (const chunk of response.body) {
			yield Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
		}
	}

	async healthCheck(): Promise<boolean> {
		try {
			const response = await fetch(`${this.BASE_URL}/voices`, {
				headers: {
					"xi-api-key": this.config.apiKey,
				},
			});
			return response.ok;
		} catch {
			return false;
		}
	}

	async shutdown(): Promise<void> {
		// Delete all cached cloned voices from ElevenLabs to avoid voice-count exhaustion.
		const deletePromises: Promise<void>[] = [];
		for (const [, voiceId] of this.clonedVoiceCache) {
			deletePromises.push(
				this.deleteClonedVoice(voiceId).catch((err: Error) => {
					this.logger?.warn(
						`[ElevenLabs] Failed to delete cloned voice ${voiceId} on shutdown: ${err.message}`,
					);
				}),
			);
		}
		await Promise.allSettled(deletePromises);
		this.clonedVoiceCache.clear();
	}
}

// =============================================================================
// Plugin Registration
// =============================================================================

let _provider: ElevenLabsTTSProvider | null = null;

const PLUGIN_ID = "voice-elevenlabs-tts";

const pluginManifest: PluginManifest = {
	name: PLUGIN_ID,
	version: "1.0.0",
	description: "ElevenLabs high-quality text-to-speech",
	category: "voice",
	tags: ["tts", "elevenlabs", "voice", "speech-synthesis"],
	icon: "🔊",
	capabilities: ["tts"],
	requires: {
		env: ["ELEVENLABS_API_KEY"],
		network: { outbound: true, hosts: ["api.elevenlabs.io"] },
	},
	provides: {
		capabilities: [
			{
				type: "tts",
				id: "elevenlabs",
				displayName: "ElevenLabs TTS",
			},
		],
	},
	lifecycle: {
		shutdownBehavior: "graceful",
		shutdownTimeoutMs: 10000,
	},
	configSchema: {
		title: "ElevenLabs TTS Configuration",
		description: "Configure ElevenLabs text-to-speech API access",
		fields: [
			{
				name: "apiKey",
				type: "password",
				label: "ElevenLabs API Key",
				description: "ElevenLabs API key from elevenlabs.io",
				required: true,
				secret: true,
				setupFlow: "paste",
			},
			{
				name: "defaultVoiceId",
				type: "text",
				label: "Default Voice ID",
				description: "Default ElevenLabs voice ID",
				required: false,
			},
			{
				name: "defaultModelId",
				type: "text",
				label: "Default Model ID",
				description: "Default ElevenLabs model ID",
				required: false,
				default: "eleven_turbo_v2_5",
			},
		],
	},
};

// Extended with getManifest/getWebMCPHandlers for webui bindPluginLifecycle()
const plugin: WOPRPlugin & {
	manifest: PluginManifest;
	getManifest(): { webmcpTools: ReturnType<typeof getWebMCPToolDeclarations> };
	getWebMCPHandlers(): Record<
		string,
		(input: Record<string, unknown>) => Promise<unknown>
	>;
} = {
	name: PLUGIN_ID,
	version: "1.0.0",
	description: "ElevenLabs high-quality text-to-speech",
	manifest: pluginManifest,

	async init(pluginCtx: WOPRPluginContext) {
		ctx = pluginCtx;
		_provider = new ElevenLabsTTSProvider({
			apiKey: process.env.ELEVENLABS_API_KEY,
		});
		_provider.logger = ctx.log;

		ctx.log.warn(
			"[ElevenLabs] Cloned voice cache is in-memory only. Voices will be recreated after restart. " +
				"Evicted and shutdown voices are deleted from ElevenLabs automatically.",
		);

		// Register config schema (always defined; if-check satisfies type narrowing)
		if (pluginManifest.configSchema) {
			ctx.registerConfigSchema(PLUGIN_ID, pluginManifest.configSchema);
			cleanups.push(() => {
				ctx?.unregisterConfigSchema(PLUGIN_ID);
			});
		}

		// Initialize voice cache on startup (fire-and-forget)
		_provider.fetchVoices().catch((err: unknown) => {
			ctx?.log.warn(
				"Failed to fetch ElevenLabs voices on startup:",
				err instanceof Error ? err.message : String(err),
			);
		});

		ctx.registerExtension("tts", _provider);
		cleanups.push(() => {
			ctx?.unregisterExtension("tts");
		});

		// registerCapabilityProvider exists at runtime but not yet in published types
		type CtxWithCapabilityProvider = {
			registerCapabilityProvider(
				type: string,
				provider: { id: string; name: string },
			): void;
			unregisterCapabilityProvider?(type: string, id: string): void;
		};
		if (
			"registerCapabilityProvider" in pluginCtx &&
			typeof (pluginCtx as unknown as CtxWithCapabilityProvider)
				.registerCapabilityProvider === "function"
		) {
			const extCtx = pluginCtx as unknown as CtxWithCapabilityProvider;
			try {
				extCtx.registerCapabilityProvider("tts", {
					id: _provider.metadata.name,
					name: _provider.metadata.description || _provider.metadata.name,
				});
				cleanups.push(() => {
					if (
						ctx &&
						"unregisterCapabilityProvider" in ctx &&
						typeof (ctx as unknown as CtxWithCapabilityProvider)
							.unregisterCapabilityProvider === "function"
					) {
						(
							ctx as unknown as CtxWithCapabilityProvider
						).unregisterCapabilityProvider?.(
							"tts",
							_provider?.metadata.name ?? "",
						);
					}
				});
			} catch (err: unknown) {
				ctx?.log.warn(
					"Failed to register TTS capability provider:",
					err instanceof Error ? err.message : String(err),
				);
			}
		}
	},

	getManifest() {
		return { webmcpTools: getWebMCPToolDeclarations() };
	},

	getWebMCPHandlers() {
		if (!_provider) return {};
		return getWebMCPHandlers(_provider, _provider.currentModelId);
	},

	async shutdown() {
		// Run all cleanup functions in reverse registration order
		for (const cleanup of cleanups.reverse()) {
			try {
				cleanup();
			} catch {
				// Ignore cleanup errors during shutdown
			}
		}
		cleanups.length = 0;

		if (_provider) {
			await _provider.shutdown();
			_provider = null;
		}
		ctx = null;
	},
};

export default plugin;

// =============================================================================
// Exports
// =============================================================================

export type {
	AudioFormat,
	ElevenLabsConfig,
	ElevenLabsModel,
	ElevenLabsOutputFormat,
	ElevenLabsTTSOptions,
	TTSOptions,
	TTSProvider,
	TTSSynthesisResult,
	Voice,
	VoiceDirective,
	VoicePluginMetadata,
} from "./types.js";
