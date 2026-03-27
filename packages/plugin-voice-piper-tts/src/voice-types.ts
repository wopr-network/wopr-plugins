/**
 * Local copy of voice type definitions.
 *
 * These mirror the types from wopr/voice (internal monorepo module).
 * Defined locally because @wopr-network/plugin-types does not yet export them.
 */

export type AudioFormat =
	| "pcm_s16le"
	| "pcm_f32le"
	| "opus"
	| "ogg_opus"
	| "mp3"
	| "wav"
	| "webm_opus"
	| "mulaw"
	| "alaw";

export type InstallMethod =
	| { kind: "brew"; formula: string; bins?: string[]; label?: string }
	| { kind: "apt"; package: string; bins?: string[]; label?: string }
	| { kind: "pip"; package: string; bins?: string[]; label?: string }
	| { kind: "npm"; package: string; bins?: string[]; label?: string }
	| { kind: "docker"; image: string; tag?: string; label?: string }
	| { kind: "script"; url: string; label?: string }
	| { kind: "manual"; instructions: string; label?: string };

export interface VoicePluginRequirements {
	bins?: string[];
	env?: string[];
	docker?: string[];
	config?: string[];
}

export interface VoicePluginMetadata {
	name: string;
	version: string;
	type: "stt" | "tts";
	description: string;
	capabilities: string[];
	local: boolean;
	docker?: boolean;
	requires?: VoicePluginRequirements;
	install?: InstallMethod[];
	primaryEnv?: string;
	emoji?: string;
	homepage?: string;
}

export interface Voice {
	id: string;
	name: string;
	language?: string;
	gender?: "male" | "female" | "neutral";
	description?: string;
}

export interface TTSOptions {
	voice?: string;
	speed?: number;
	pitch?: number;
	format?: AudioFormat;
	sampleRate?: number;
	instructions?: string;
}

export interface TTSSynthesisResult {
	audio: Buffer;
	format: AudioFormat;
	sampleRate: number;
	durationMs: number;
}

export interface TTSProvider {
	readonly metadata: VoicePluginMetadata;
	readonly voices: Voice[];
	validateConfig(): void;
	synthesize(text: string, options?: TTSOptions): Promise<TTSSynthesisResult>;
	streamSynthesize?(text: string, options?: TTSOptions): AsyncGenerator<Buffer>;
	synthesizeBatch?(
		texts: string[],
		options?: TTSOptions,
	): Promise<TTSSynthesisResult[]>;
	healthCheck?(): Promise<boolean>;
	shutdown?(): Promise<void>;
}
