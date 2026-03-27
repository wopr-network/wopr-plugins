/**
 * Chatterbox plugin-local types.
 *
 * WOPRPlugin and WOPRPluginContext are imported from @wopr-network/plugin-types.
 * TTS provider interfaces are not exported from plugin-types as concrete interfaces
 * (context uses `unknown` for registerExtension/registerTTSProvider), so they
 * stay local for internal type safety.
 */

export interface ChatterboxConfig {
  /** Server URL (e.g., http://chatterbox-tts:5123) */
  serverUrl?: string;
  /** Default voice name */
  voice?: string;
  /** Exaggeration level (0.0-1.0) - controls expressiveness */
  exaggeration?: number;
  /** CFG weight (0.0-1.0) - controls adherence to voice characteristics */
  cfgWeight?: number;
  /** Temperature (0.0-1.0) - controls randomness */
  temperature?: number;
}

export interface TTSSynthesisResult {
  audio: Buffer;
  format: "pcm_s16le" | "mp3" | "wav" | "opus";
  sampleRate: number;
  durationMs: number;
}

export interface TTSOptions {
  voice?: string;
  speed?: number;
  sampleRate?: number;
  /** WAV/MP3 audio buffer of a reference voice for cloning */
  referenceAudio?: Buffer;
  /** Exaggeration level (0.0-1.0) - controls expressiveness */
  exaggeration?: number;
  /** CFG weight (0.0-1.0) - controls adherence to voice characteristics */
  cfgWeight?: number;
}

export interface Voice {
  id: string;
  name: string;
  language?: string;
  gender?: "male" | "female" | "neutral";
  description?: string;
}

export interface VoicePluginMetadata {
  name: string;
  version: string;
  type: "stt" | "tts";
  description: string;
  capabilities?: string[];
  local?: boolean;
}

export interface TTSProvider {
  readonly metadata: VoicePluginMetadata;
  readonly voices: Voice[];
  synthesize(text: string, options?: TTSOptions): Promise<TTSSynthesisResult>;
  healthCheck?(): Promise<boolean>;
  shutdown?(): Promise<void>;
  validateConfig(): void;
}
