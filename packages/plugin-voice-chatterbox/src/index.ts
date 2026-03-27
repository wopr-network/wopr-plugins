/**
 * WOPR Voice Plugin: Chatterbox TTS
 *
 * Connects to Chatterbox TTS server via OpenAI-compatible HTTP API.
 * Supports voice cloning and high-quality speech synthesis.
 *
 * Docker: travisvn/chatterbox-tts-api or devnen/chatterbox-tts-server
 */

import type { WOPRPlugin, WOPRPluginContext } from "@wopr-network/plugin-types";
import type {
  ChatterboxConfig,
  TTSOptions,
  TTSProvider,
  TTSSynthesisResult,
  Voice,
  VoicePluginMetadata,
} from "./types.js";

const DEFAULT_CONFIG: Required<ChatterboxConfig> = {
  serverUrl: process.env.CHATTERBOX_URL || "http://chatterbox-tts:5123",
  voice: process.env.CHATTERBOX_VOICE || "default",
  exaggeration: 0.5,
  cfgWeight: 0.5,
  temperature: 0.8,
};

/**
 * Parse WAV header to extract sample rate
 */
function parseWavSampleRate(buffer: Buffer): number {
  if (buffer.length < 28) return 24000;
  if (buffer.toString("ascii", 0, 4) !== "RIFF") return 24000;
  return buffer.readUInt32LE(24);
}

/**
 * Extract PCM data from WAV buffer
 */
export function wavToPcm(wavBuffer: Buffer): { pcm: Buffer; sampleRate: number } {
  let offset = 12;
  let sampleRate = 24000;

  while (offset < wavBuffer.length - 8) {
    const chunkId = wavBuffer.toString("ascii", offset, offset + 4);
    const chunkSize = wavBuffer.readUInt32LE(offset + 4);

    if (chunkId === "fmt ") {
      sampleRate = wavBuffer.readUInt32LE(offset + 12);
    } else if (chunkId === "data") {
      const pcm = wavBuffer.subarray(offset + 8, offset + 8 + chunkSize);
      return { pcm, sampleRate };
    }

    offset += 8 + chunkSize;
  }

  return {
    pcm: wavBuffer.subarray(44),
    sampleRate: parseWavSampleRate(wavBuffer),
  };
}

export class ChatterboxProvider implements TTSProvider {
  readonly metadata: VoicePluginMetadata = {
    name: "chatterbox",
    version: "1.0.0",
    type: "tts",
    description: "High-quality TTS via Chatterbox (OpenAI-compatible)",
    capabilities: ["voice-selection", "voice-cloning", "expressiveness"],
    local: true,
  };

  readonly voices: Voice[] = [{ id: "default", name: "Default", language: "en", gender: "neutral" }];

  private config: Required<ChatterboxConfig>;
  private dynamicVoices: Voice[] = [];

  constructor(config: ChatterboxConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  get serverUrl(): string {
    return this.config.serverUrl;
  }

  validateConfig(): void {
    if (!this.config.serverUrl) {
      throw new Error("serverUrl is required");
    }
  }

  async fetchVoices(): Promise<void> {
    try {
      const response = await fetch(`${this.config.serverUrl}/voices`, {
        method: "GET",
        signal: AbortSignal.timeout(5000),
      });

      if (response.ok) {
        const data = (await response.json()) as unknown[];
        if (Array.isArray(data)) {
          this.dynamicVoices = data.map((v: unknown) => {
            const voice = v as Record<string, unknown>;
            return {
              id: (voice.id as string) || (voice.name as string) || String(v),
              name: (voice.name as string) || (voice.id as string) || String(v),
              language: (voice.language as string) || "en",
              gender: (voice.gender as Voice["gender"]) || "neutral",
              description: voice.description as string | undefined,
            };
          });
        }
      }
    } catch {
      // Voice fetch failed, use defaults
    }
  }

  async synthesize(text: string, options?: TTSOptions): Promise<TTSSynthesisResult> {
    const startTime = Date.now();
    const voice = options?.voice || this.config.voice;

    const exaggeration = options?.exaggeration ?? this.config.exaggeration;
    const cfgWeight = options?.cfgWeight ?? this.config.cfgWeight;

    const referenceAudio = options?.referenceAudio;
    if (referenceAudio) {
      return this.synthesizeWithCloning(text, referenceAudio, {
        exaggeration,
        cfgWeight,
        temperature: this.config.temperature,
      });
    }

    const requestBody = {
      input: text,
      voice: voice,
      model: "chatterbox",
      response_format: "wav",
      exaggeration,
      cfg_weight: cfgWeight,
      temperature: this.config.temperature,
    };

    let response: Response;
    try {
      response = await fetch(`${this.config.serverUrl}/v1/audio/speech`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(60000),
      });
    } catch {
      response = await fetch(`${this.config.serverUrl}/synthesize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          voice,
          exaggeration,
          cfg_weight: cfgWeight,
          temperature: this.config.temperature,
        }),
        signal: AbortSignal.timeout(60000),
      });
    }

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Chatterbox TTS error: ${response.status} - ${error}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const wavBuffer = Buffer.from(arrayBuffer);
    const { pcm, sampleRate } = wavToPcm(wavBuffer);

    return {
      audio: pcm,
      format: "pcm_s16le",
      sampleRate,
      durationMs: Date.now() - startTime,
    };
  }

  private async synthesizeWithCloning(
    text: string,
    referenceAudio: Buffer,
    params: { exaggeration: number; cfgWeight: number; temperature: number },
  ): Promise<TTSSynthesisResult> {
    const startTime = Date.now();

    const formData = new FormData();
    formData.append("text", text);
    const audioArrayBuffer = new ArrayBuffer(referenceAudio.byteLength);
    new Uint8Array(audioArrayBuffer).set(referenceAudio);
    formData.append("audio", new Blob([audioArrayBuffer], { type: "audio/wav" }), "reference.wav");
    formData.append("exaggeration", params.exaggeration.toString());
    formData.append("cfg_weight", params.cfgWeight.toString());
    formData.append("temperature", params.temperature.toString());

    const response = await fetch(`${this.config.serverUrl}/synthesize`, {
      method: "POST",
      body: formData,
      signal: AbortSignal.timeout(120000),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Chatterbox voice cloning error: ${response.status} - ${error}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const wavBuffer = Buffer.from(arrayBuffer);
    const { pcm, sampleRate } = wavToPcm(wavBuffer);

    return {
      audio: pcm,
      format: "pcm_s16le",
      sampleRate,
      durationMs: Date.now() - startTime,
    };
  }

  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${this.config.serverUrl}/health`, {
        method: "GET",
        signal: AbortSignal.timeout(5000),
      });
      return response.ok;
    } catch {
      try {
        const response = await fetch(this.config.serverUrl, {
          method: "GET",
          signal: AbortSignal.timeout(5000),
        });
        return response.ok || response.status === 404;
      } catch {
        return false;
      }
    }
  }

  async shutdown(): Promise<void> {
    // No cleanup needed
  }

  getAllVoices(): Voice[] {
    return this.dynamicVoices.length > 0 ? this.dynamicVoices : this.voices;
  }
}

let provider: ChatterboxProvider | null = null;

const plugin: WOPRPlugin = {
  name: "voice-chatterbox",
  version: "1.0.0",
  description: "High-quality TTS via Chatterbox",

  async init(ctx: WOPRPluginContext) {
    const config = ctx.getConfig<ChatterboxConfig>();
    provider = new ChatterboxProvider(config);

    try {
      provider.validateConfig();
      const healthy = await provider.healthCheck();
      if (healthy) {
        await provider.fetchVoices();
        ctx.registerExtension("tts", provider);
        ctx.registerProvider(provider);
        ctx.log.info(`Chatterbox TTS registered (${provider.serverUrl})`);
      } else {
        ctx.log.warn(`Chatterbox server not reachable at ${provider.serverUrl}`);
      }
    } catch (err: unknown) {
      ctx.log.error(`Failed to init Chatterbox TTS: ${err}`);
    }
  },

  async shutdown() {
    if (provider) {
      await provider.shutdown();
      provider = null;
    }
  },
};

export default plugin;
