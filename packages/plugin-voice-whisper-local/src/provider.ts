// src/provider.ts
import type Docker from "dockerode";
import type {
  STTOptions,
  STTProvider,
  STTSession,
  STTTranscriptChunk,
  VoicePluginMetadata,
  WhisperLocalConfig,
} from "./types.js";
import { DEFAULT_CONFIG, VALID_MODELS } from "./types.js";

const TRANSCRIPTION_TIMEOUT_MS = 60_000;

export class WhisperLocalSession implements STTSession {
  private chunks: Buffer[] = [];
  private ended = false;

  constructor(
    private serverUrl: string,
    private options: STTOptions,
  ) {}

  sendAudio(audio: Buffer): void {
    if (this.ended) {
      throw new Error("Session ended, cannot send more audio");
    }
    this.chunks.push(audio);
  }

  endAudio(): void {
    this.ended = true;
  }

  // biome-ignore lint/correctness/noUnusedVariables: interface requirement, streaming not yet implemented
  onPartial(_callback: (chunk: STTTranscriptChunk) => void): void {
    // Streaming partials not yet implemented for batch whisper
  }

  async waitForTranscript(timeoutMs = 30000): Promise<string> {
    const startTime = Date.now();
    while (!this.ended && Date.now() - startTime < timeoutMs) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    if (!this.ended) {
      throw new Error("Transcript timeout - audio stream not ended");
    }

    const audioBuffer = Buffer.concat(this.chunks);

    const formData = new FormData();
    formData.append("file", new Blob([new Uint8Array(audioBuffer)], { type: "audio/wav" }), "audio.wav");
    formData.append("language", this.options.language ?? "en");

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TRANSCRIPTION_TIMEOUT_MS);
    try {
      const response = await fetch(`${this.serverUrl}/v1/audio/transcriptions`, {
        method: "POST",
        body: formData,
        signal: controller.signal,
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Whisper server error: ${response.status} - ${error}`);
      }

      const result = (await response.json()) as { text?: string };
      return result.text ?? "";
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async close(): Promise<void> {
    this.ended = true;
    this.chunks = [];
  }
}

export class WhisperLocalProvider implements STTProvider {
  readonly metadata: VoicePluginMetadata = {
    name: "whisper-local",
    version: "1.0.0",
    type: "stt",
    description: "Local STT using faster-whisper in Docker",
    capabilities: ["batch", "streaming"],
    local: true,
    docker: true,
    emoji: "\uD83C\uDFA4",
    homepage: "https://github.com/SYSTRAN/faster-whisper",
    requires: {
      docker: ["fedirz/faster-whisper-server:latest"],
    },
    install: [
      {
        kind: "docker",
        image: "fedirz/faster-whisper-server",
        tag: "latest-cpu",
        label: "Pull faster-whisper server image",
      },
    ],
  };

  private config: Required<WhisperLocalConfig>;
  private serverUrl: string;
  private containerId?: string;
  private docker?: Docker;
  private _startingServer: Promise<void> | null = null;

  constructor(config: WhisperLocalConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.serverUrl = `http://localhost:${this.config.port}`;
  }

  get model(): string {
    return this.config.model;
  }

  validateConfig(): void {
    if (!VALID_MODELS.includes(this.config.model)) {
      throw new Error(`Invalid model: ${this.config.model}. Valid: ${VALID_MODELS.join(", ")}`);
    }
    if (this.config.port < 1024 || this.config.port > 65535) {
      throw new Error(`Invalid port: ${this.config.port}`);
    }
  }

  async createSession(options?: STTOptions): Promise<STTSession> {
    await this.ensureServerRunning();
    return new WhisperLocalSession(this.serverUrl, {
      language: this.config.language,
      ...options,
    });
  }

  async transcribe(audio: Buffer, options?: STTOptions): Promise<string> {
    await this.ensureServerRunning();

    const formData = new FormData();
    formData.append("file", new Blob([new Uint8Array(audio)], { type: "audio/wav" }), "audio.wav");
    formData.append("language", options?.language ?? this.config.language);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TRANSCRIPTION_TIMEOUT_MS);
    try {
      const response = await fetch(`${this.serverUrl}/v1/audio/transcriptions`, {
        method: "POST",
        body: formData,
        signal: controller.signal,
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Whisper server error: ${response.status} - ${error}`);
      }

      const result = (await response.json()) as { text?: string };
      return result.text ?? "";
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${this.serverUrl}/health`, {
        method: "GET",
        signal: AbortSignal.timeout(5000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async shutdown(): Promise<void> {
    if (this.containerId && this.docker) {
      try {
        const container = this.docker.getContainer(this.containerId);
        await container.stop();
        await container.remove();
      } catch {
        // Ignore cleanup errors
      }
    }
    this.containerId = undefined;
  }

  private async ensureServerRunning(): Promise<void> {
    if (this._startingServer) {
      return this._startingServer;
    }
    if (await this.healthCheck()) {
      return;
    }
    this._startingServer = this._doStartServer().finally(() => {
      this._startingServer = null;
    });
    return this._startingServer;
  }

  private async _doStartServer(): Promise<void> {
    await this.startContainer();
    const maxWait = 60000;
    const startTime = Date.now();
    while (Date.now() - startTime < maxWait) {
      if (await this.healthCheck()) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    throw new Error("Whisper server failed to start within 60 seconds");
  }

  private async startContainer(): Promise<void> {
    if (!this.docker) {
      const DockerLib = (await import("dockerode")).default;
      this.docker = new DockerLib();
    }

    try {
      await this.pullImage();
    } catch {
      // Ignore pull errors — image may already exist
    }

    const container = await this.docker.createContainer({
      Image: this.config.image,
      Env: [`WHISPER_MODEL=${this.config.model}`, `WHISPER_LANGUAGE=${this.config.language}`],
      HostConfig: {
        PortBindings: {
          "8000/tcp": [{ HostPort: String(this.config.port) }],
        },
        AutoRemove: true,
      },
      ExposedPorts: {
        "8000/tcp": {},
      },
    });

    await container.start();
    this.containerId = container.id;
  }

  private async pullImage(): Promise<void> {
    return new Promise((resolve, reject) => {
      // biome-ignore lint/suspicious/noExplicitAny: dockerode pull callback uses untyped stream
      this.docker!.pull(this.config.image, (err: Error | null, stream: any) => {
        if (err) {
          reject(err);
          return;
        }
        // biome-ignore lint/suspicious/noExplicitAny: dockerode modem.followProgress uses untyped callbacks
        (this.docker!.modem as any).followProgress(stream, (progressErr: Error | null) =>
          progressErr ? reject(progressErr) : resolve(),
        );
      });
    });
  }
}
