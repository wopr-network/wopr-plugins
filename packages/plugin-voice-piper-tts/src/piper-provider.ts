import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type Docker from "dockerode";
import { DEFAULT_CONFIG, type PiperTTSConfig } from "./types.js";
import type {
	TTSOptions,
	TTSProvider,
	TTSSynthesisResult,
	Voice,
	VoicePluginMetadata,
} from "./voice-types.js";
import { PIPER_VOICES } from "./voices.js";

export class PiperTTSProvider implements TTSProvider {
	readonly metadata: VoicePluginMetadata = {
		name: "piper-tts",
		version: "1.0.0",
		type: "tts",
		description: "Local TTS using Piper in Docker",
		capabilities: ["voice-selection", "speed-control"],
		local: true,
		docker: true,
		emoji: "🔊",
		homepage: "https://github.com/rhasspy/piper",
		requires: {
			docker: ["rhasspy/piper:latest"],
		},
		install: [
			{
				kind: "docker",
				image: "rhasspy/piper",
				tag: "latest",
				label: "Pull Piper TTS image",
			},
		],
	};

	readonly voices: Voice[] = PIPER_VOICES;

	private config: Required<Omit<PiperTTSConfig, "modelCachePath">> & {
		modelCachePath?: string;
	};
	private docker: Docker | undefined;
	private downloadedModels = new Set<string>();

	constructor(config: PiperTTSConfig = {}) {
		this.config = { ...DEFAULT_CONFIG, ...config };
		if (config.modelCachePath) {
			this.config.modelCachePath = config.modelCachePath;
		}
	}

	validateConfig(): void {
		const voiceExists = this.voices.some((v) => v.id === this.config.voice);
		if (!voiceExists) {
			throw new Error(
				`Invalid voice: ${this.config.voice}. Use one of: ${this.voices.map((v) => v.id).join(", ")}`,
			);
		}

		const validRates = [16000, 22050, 24000, 48000];
		if (!validRates.includes(this.config.sampleRate)) {
			throw new Error(
				`Invalid sample rate: ${this.config.sampleRate}. Valid: ${validRates.join(", ")}`,
			);
		}

		if (this.config.speed < 0.5 || this.config.speed > 2.0) {
			throw new Error(`Invalid speed: ${this.config.speed}. Must be 0.5-2.0`);
		}
	}

	async synthesize(
		text: string,
		options?: TTSOptions,
	): Promise<TTSSynthesisResult> {
		const voice = options?.voice || this.config.voice;
		const speed = options?.speed || this.config.speed;
		const sampleRate = options?.sampleRate || this.config.sampleRate;

		await this.ensureModelDownloaded(voice);

		const tempDir = tmpdir();
		const textFile = join(tempDir, `piper-input-${Date.now()}.txt`);
		const wavFile = join(tempDir, `piper-output-${Date.now()}.wav`);

		try {
			await writeFile(textFile, text, "utf-8");

			const startTime = Date.now();
			await this.runPiperContainer(textFile, wavFile, voice, speed, sampleRate);

			const wavBuffer = await readFile(wavFile);
			const pcmBuffer = this.wavToPcm(wavBuffer);

			const durationMs = Date.now() - startTime;

			return {
				audio: pcmBuffer,
				format: "pcm_s16le",
				sampleRate,
				durationMs,
			};
		} finally {
			await unlink(textFile).catch(() => {});
			await unlink(wavFile).catch(() => {});
		}
	}

	async healthCheck(): Promise<boolean> {
		try {
			if (!this.docker) {
				const Docker = (await import("dockerode")).default;
				this.docker = new Docker();
			}
			await this.docker.listContainers({ limit: 1 });
			return true;
		} catch (_error: unknown) {
			return false;
		}
	}

	async shutdown(): Promise<void> {
		this.docker = undefined;
		this.downloadedModels.clear();
	}

	private async ensureModelDownloaded(voice: string): Promise<void> {
		if (this.downloadedModels.has(voice)) {
			return;
		}

		console.log(`[piper-tts] Downloading voice model: ${voice}...`);

		if (!this.docker) {
			const Docker = (await import("dockerode")).default;
			this.docker = new Docker();
		}

		try {
			await this.pullImage();
		} catch (error: unknown) {
			console.warn("[piper-tts] Image pull warning:", error);
		}

		const modelDir =
			this.config.modelCachePath || join(tmpdir(), "piper-models");
		await mkdir(modelDir, { recursive: true });

		const container = await this.docker.createContainer({
			Image: this.config.image,
			Cmd: ["--model", voice, "--download-dir", "/models", "--help"],
			HostConfig: {
				Binds: [`${modelDir}:/models`],
				AutoRemove: true,
			},
		});

		await container.start();
		await container.wait();

		this.downloadedModels.add(voice);
		console.log(`[piper-tts] Voice model downloaded: ${voice}`);
	}

	private async runPiperContainer(
		inputFile: string,
		outputFile: string,
		voice: string,
		speed: number,
		sampleRate: number,
	): Promise<void> {
		if (!this.docker) {
			const Docker = (await import("dockerode")).default;
			this.docker = new Docker();
		}

		const modelDir =
			this.config.modelCachePath || join(tmpdir(), "piper-models");

		const container = await this.docker.createContainer({
			Image: this.config.image,
			Cmd: [
				"--model",
				voice,
				"--output_file",
				"/output/output.wav",
				"--length_scale",
				String(1 / speed),
				"--sample_rate",
				String(sampleRate),
			],
			AttachStdin: true,
			AttachStdout: true,
			AttachStderr: true,
			OpenStdin: true,
			StdinOnce: true,
			HostConfig: {
				Binds: [
					`${modelDir}:/models`,
					`${inputFile}:/input/input.txt:ro`,
					`${join(outputFile, "..")}:/output`,
				],
				AutoRemove: true,
			},
		});

		const stream = await container.attach({
			stream: true,
			stdin: true,
			stdout: true,
			stderr: true,
		});

		await container.start();

		const fs = await import("node:fs");
		const textStream = fs.createReadStream(inputFile);
		textStream.pipe(stream);

		await container.wait();
	}

	/**
	 * Convert WAV file to raw PCM by stripping the WAV header.
	 * Assumes standard 44-byte WAV header.
	 */
	private wavToPcm(wavBuffer: Buffer): Buffer {
		const headerSize = 44;

		if (wavBuffer.length < headerSize) {
			throw new Error("Invalid WAV file: too small");
		}

		const riffHeader = wavBuffer.toString("ascii", 0, 4);
		const waveHeader = wavBuffer.toString("ascii", 8, 12);

		if (riffHeader !== "RIFF" || waveHeader !== "WAVE") {
			throw new Error("Invalid WAV file: missing RIFF/WAVE headers");
		}

		return wavBuffer.subarray(headerSize);
	}

	private async pullImage(): Promise<void> {
		// biome-ignore lint/style/noNonNullAssertion: docker is guaranteed set before pullImage is called
		const docker = this.docker!;
		return new Promise((resolve, reject) => {
			// biome-ignore lint/suspicious/noExplicitAny: Dockerode modem API is untyped
			(docker as any).pull(
				this.config.image,
				(error: unknown, stream: NodeJS.ReadableStream) => {
					if (error) {
						reject(error);
						return;
					}
					// biome-ignore lint/suspicious/noExplicitAny: Dockerode modem API is untyped
					(docker as any).modem.followProgress(
						stream,
						(err: unknown) => (err ? reject(err) : resolve()),
						(event: { status?: string }) => {
							if (event.status) {
								console.log(`[piper-tts] ${event.status}`);
							}
						},
					);
				},
			);
		});
	}
}
