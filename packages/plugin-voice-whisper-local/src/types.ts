// src/types.ts
import type { ConfigSchema } from "@wopr-network/plugin-types";

export interface WhisperLocalConfig {
  /** Docker image to use */
  image?: string;
  /** Model size: tiny, base, small, medium, large-v3 */
  model?: string;
  /** Port to expose the whisper server on */
  port?: number;
  /** Language code (e.g., "en", "auto" for auto-detect) */
  language?: string;
  /** Enable word timestamps */
  wordTimestamps?: boolean;
}

export const DEFAULT_CONFIG: Required<WhisperLocalConfig> = {
  image: "fedirz/faster-whisper-server:latest-cpu",
  model: "small",
  port: 8765,
  language: "en",
  wordTimestamps: false,
};

export const VALID_MODELS = ["tiny", "base", "small", "medium", "large-v3"];

// STT types (defined locally since @wopr-network/plugin-types only exports minimal stubs)
export interface STTOptions {
  language?: string;
  wordTimestamps?: boolean;
}

export interface STTTranscriptChunk {
  text: string;
  isFinal?: boolean;
  confidence?: number;
}

export interface STTSession {
  sendAudio(audio: Buffer): void;
  endAudio(): void;
  onPartial(callback: (chunk: STTTranscriptChunk) => void): void;
  waitForTranscript(timeoutMs?: number): Promise<string>;
  close(): Promise<void>;
}

export interface VoicePluginMetadata {
  name: string;
  version: string;
  type: "stt" | "tts";
  description: string;
  capabilities: string[];
  local?: boolean;
  docker?: boolean;
  emoji?: string;
  homepage?: string;
  requires?: { docker?: string[] };
  install?: Array<{ kind: string; image: string; tag?: string; label?: string }>;
}

export interface STTProvider {
  readonly metadata: VoicePluginMetadata;
  validateConfig(): void;
  createSession(options?: STTOptions): Promise<STTSession>;
  transcribe(audio: Buffer, options?: STTOptions): Promise<string>;
  healthCheck(): Promise<boolean>;
  shutdown(): Promise<void>;
}

export const configSchema: ConfigSchema = {
  title: "Whisper Local (faster-whisper)",
  description: "Local speech-to-text using faster-whisper in Docker",
  fields: [
    {
      name: "model",
      type: "select",
      label: "Model Size",
      description: "Larger models are more accurate but slower and use more memory",
      default: "small",
      options: [
        { value: "tiny", label: "Tiny (fastest, least accurate)" },
        { value: "base", label: "Base" },
        { value: "small", label: "Small (recommended)" },
        { value: "medium", label: "Medium" },
        { value: "large-v3", label: "Large v3 (most accurate, requires ~3GB+ VRAM)" },
      ],
    },
    {
      name: "port",
      type: "number",
      label: "Server Port",
      description: "Port to expose the whisper server on",
      default: 8765,
      placeholder: "8765",
    },
    {
      name: "language",
      type: "text",
      label: "Language",
      description: "Language code (e.g., 'en', 'auto' for auto-detect)",
      default: "en",
      placeholder: "en",
    },
    {
      name: "image",
      type: "text",
      label: "Docker Image",
      description: "Docker image to use for the whisper server",
      default: "fedirz/faster-whisper-server:latest-cpu",
      placeholder: "fedirz/faster-whisper-server:latest-cpu",
    },
  ],
};
