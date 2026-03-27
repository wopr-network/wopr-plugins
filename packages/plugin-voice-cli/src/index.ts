/**
 * WOPR Voice CLI Plugin
 *
 * Provides CLI commands for voice operations:
 *   wopr voice transcribe <file>           Transcribe audio file using STT
 *   wopr voice synthesize <voice> <text>   Synthesize speech using TTS
 *   wopr voice list                        List available voices
 *   wopr voice providers                   Show registered STT/TTS providers
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, extname } from "node:path";
import type {
	PluginCommand,
	WOPRPlugin,
	WOPRPluginContext,
} from "@wopr-network/plugin-types";

// Voice-specific types not yet in plugin-types
interface VoiceMetadata {
	name: string;
	version: string;
	description?: string;
	emoji?: string;
	local?: boolean;
}

interface TTSVoice {
	id: string;
	name?: string;
	gender?: string;
	description?: string;
}

interface STTProvider {
	metadata: VoiceMetadata;
	transcribe(
		audio: Buffer,
		options?: Record<string, unknown>,
	): Promise<{ text: string; durationMs: number; confidence?: number }>;
}

interface TTSProvider {
	metadata: VoiceMetadata;
	voices: TTSVoice[];
	synthesize(
		text: string,
		options?: Record<string, unknown>,
	): Promise<{
		audio: Buffer;
		format: string;
		sampleRate?: number;
		durationMs: number;
	}>;
}

// Runtime type guards — validate capability providers before use
function isVoiceMetadata(value: unknown): value is VoiceMetadata {
	return (
		typeof value === "object" &&
		value !== null &&
		typeof (value as { name?: unknown }).name === "string" &&
		typeof (value as { version?: unknown }).version === "string"
	);
}

function isSTTProvider(value: unknown): value is STTProvider {
	return (
		typeof value === "object" &&
		value !== null &&
		isVoiceMetadata((value as { metadata?: unknown }).metadata) &&
		typeof (value as { transcribe?: unknown }).transcribe === "function"
	);
}

function isTTSProvider(value: unknown): value is TTSProvider {
	if (typeof value !== "object" || value === null) return false;
	const metadata = (value as { metadata?: unknown }).metadata;
	const voices = (value as { voices?: unknown }).voices;
	return (
		isVoiceMetadata(metadata) &&
		Array.isArray(voices) &&
		voices.every(
			(voice) =>
				typeof voice === "object" &&
				voice !== null &&
				typeof (voice as { id?: unknown }).id === "string" &&
				((voice as { name?: unknown }).name === undefined ||
					typeof (voice as { name?: unknown }).name === "string") &&
				((voice as { gender?: unknown }).gender === undefined ||
					typeof (voice as { gender?: unknown }).gender === "string") &&
				((voice as { description?: unknown }).description === undefined ||
					typeof (voice as { description?: unknown }).description === "string"),
		) &&
		typeof (value as { synthesize?: unknown }).synthesize === "function"
	);
}

function firstProvider<T>(
	providers: unknown[] | undefined,
	guard: (v: unknown) => v is T,
): T | null {
	if (!providers) return null;
	for (const p of providers) {
		if (guard(p)) return p;
	}
	return null;
}

const commands: PluginCommand[] = [
	{
		name: "voice",
		description: "Voice transcription and synthesis commands",
		usage: `wopr voice <subcommand> [options]

Subcommands:
  transcribe <file> [--output file]     Transcribe audio file to text
  synthesize <voice> "<text>" [--output file]  Synthesize text to speech
  list                                  List available TTS voices
  providers                             Show registered voice providers

Examples:
  wopr voice transcribe recording.wav
  wopr voice transcribe meeting.mp3 --output transcript.txt
  wopr voice synthesize coral "Hello everyone"
  wopr voice synthesize alloy "Welcome to WOPR" --output greeting.pcm
  wopr voice list
  wopr voice providers`,

		async handler(ctx: WOPRPluginContext, args: string[]) {
			const [subcommand, ...rest] = args;

			switch (subcommand) {
				case "transcribe": {
					await transcribeCommand(ctx, rest);
					break;
				}
				case "synthesize": {
					await synthesizeCommand(ctx, rest);
					break;
				}
				case "list": {
					await listVoicesCommand(ctx);
					break;
				}
				case "providers": {
					await providersCommand(ctx);
					break;
				}
				default:
					ctx.log.error(`Unknown subcommand: ${subcommand}`);
					ctx.log.info(
						"Usage: wopr voice <transcribe|synthesize|list|providers>",
					);
			}
		},
	},
];

// Parse --flag value pairs from args
function parseFlags(args: string[]): {
	flags: Record<string, string>;
	positional: string[];
} {
	const flags: Record<string, string> = {};
	const positional: string[] = [];

	for (let i = 0; i < args.length; i++) {
		if (args[i].startsWith("--")) {
			const key = args[i].slice(2);
			if (i + 1 < args.length && !args[i + 1].startsWith("--")) {
				flags[key] = args[++i];
			} else {
				flags[key] = "true";
			}
		} else {
			positional.push(args[i]);
		}
	}

	return { flags, positional };
}

/**
 * wopr voice transcribe <file> [--output file]
 */
async function transcribeCommand(
	ctx: WOPRPluginContext,
	args: string[],
): Promise<void> {
	const { flags, positional } = parseFlags(args);
	const [inputFile] = positional;

	if (!inputFile) {
		ctx.log.error(
			"Usage: wopr voice transcribe <audio-file> [--output transcript.txt]",
		);
		return;
	}

	if (!existsSync(inputFile)) {
		ctx.log.error(`File not found: ${inputFile}`);
		return;
	}

	const stt = firstProvider(ctx.getCapabilityProviders?.("stt"), isSTTProvider);
	if (!stt) {
		ctx.log.error("No STT provider available. Install a voice plugin:");
		ctx.log.info("  wopr plugin install wopr-plugin-voice-whisper-local");
		ctx.log.info("  wopr plugin install wopr-plugin-voice-deepgram-stt");
		return;
	}

	ctx.log.info(
		`Transcribing ${basename(inputFile)} using ${stt.metadata.name}...`,
	);

	try {
		// Read audio file
		const audioBuffer = readFileSync(inputFile);

		// Determine format from extension
		const ext = extname(inputFile).toLowerCase();
		const formatMap: Record<string, string> = {
			".wav": "wav",
			".mp3": "mp3",
			".pcm": "pcm_s16le",
			".raw": "pcm_s16le",
			".ogg": "ogg",
			".webm": "webm",
			".m4a": "m4a",
		};
		const format = formatMap[ext] || "wav";

		// Transcribe
		const result = await stt.transcribe(audioBuffer, { format });

		ctx.log.info(`\nTranscription (${result.durationMs}ms audio):`);
		ctx.log.info("─".repeat(40));
		ctx.log.info(result.text);
		ctx.log.info("─".repeat(40));

		if (result.confidence !== undefined) {
			ctx.log.info(`Confidence: ${(result.confidence * 100).toFixed(1)}%`);
		}

		// Write output file if specified
		if (flags.output) {
			writeFileSync(flags.output, result.text);
			ctx.log.info(`Saved to: ${flags.output}`);
		}
	} catch (err: unknown) {
		ctx.log.error(
			`Transcription failed: ${err instanceof Error ? err.message : String(err)}`,
		);
	}
}

/**
 * wopr voice synthesize <voice> "<text>" [--output file]
 */
async function synthesizeCommand(
	ctx: WOPRPluginContext,
	args: string[],
): Promise<void> {
	const { flags, positional } = parseFlags(args);
	const [voice, ...textParts] = positional;
	const text = textParts.join(" ");

	if (!voice || !text) {
		ctx.log.error(
			'Usage: wopr voice synthesize <voice> "<text>" [--output file.pcm]',
		);
		ctx.log.info("\nExamples:");
		ctx.log.info('  wopr voice synthesize coral "Hello world"');
		ctx.log.info(
			'  wopr voice synthesize alloy "Welcome" --output greeting.pcm',
		);
		return;
	}

	const tts = firstProvider(ctx.getCapabilityProviders?.("tts"), isTTSProvider);
	if (!tts) {
		ctx.log.error("No TTS provider available. Install a voice plugin:");
		ctx.log.info("  wopr plugin install wopr-plugin-voice-openai-tts");
		ctx.log.info("  wopr plugin install wopr-plugin-voice-elevenlabs-tts");
		ctx.log.info("  wopr plugin install wopr-plugin-voice-piper-tts");
		return;
	}

	ctx.log.info(`Synthesizing with ${tts.metadata.name} (voice: ${voice})...`);

	try {
		const result = await tts.synthesize(text, { voice });

		ctx.log.info(
			`Generated ${result.audio.length} bytes of ${result.format} audio`,
		);
		ctx.log.info(`Duration: ${result.durationMs}ms`);
		ctx.log.info(`Sample rate: ${result.sampleRate}Hz`);

		// Determine output filename
		const outputFile = flags.output || `output_${voice}.pcm`;
		writeFileSync(outputFile, result.audio);
		ctx.log.info(`Saved to: ${outputFile}`);

		// Hint for playback
		if (result.format === "pcm_s16le") {
			ctx.log.info(
				`\nPlayback: aplay -r ${result.sampleRate} -f S16_LE -c 1 ${outputFile}`,
			);
		}
	} catch (err: unknown) {
		ctx.log.error(
			`Synthesis failed: ${err instanceof Error ? err.message : String(err)}`,
		);
	}
}

/**
 * wopr voice list - List available TTS voices
 */
async function listVoicesCommand(ctx: WOPRPluginContext): Promise<void> {
	const tts = firstProvider(ctx.getCapabilityProviders?.("tts"), isTTSProvider);
	if (!tts) {
		ctx.log.error("No TTS provider available.");
		return;
	}

	ctx.log.info(`Voices from ${tts.metadata.name}:`);
	ctx.log.info("─".repeat(60));
	ctx.log.info("ID              | Name           | Gender  | Description");
	ctx.log.info("─".repeat(60));

	for (const voice of tts.voices) {
		const id = voice.id.padEnd(15);
		const name = (voice.name || voice.id).padEnd(14);
		const gender = (voice.gender || "?").padEnd(7);
		const desc = voice.description || "";
		ctx.log.info(`${id} | ${name} | ${gender} | ${desc}`);
	}
}

/**
 * wopr voice providers - Show registered voice providers
 */
async function providersCommand(ctx: WOPRPluginContext): Promise<void> {
	const stt = firstProvider(ctx.getCapabilityProviders?.("stt"), isSTTProvider);
	const tts = firstProvider(ctx.getCapabilityProviders?.("tts"), isTTSProvider);

	ctx.log.info("Voice Providers:");
	ctx.log.info("─".repeat(50));

	ctx.log.info("\nSTT (Speech-to-Text):");
	if (stt) {
		ctx.log.info(
			`  ${stt.metadata.emoji || "🎤"} ${stt.metadata.name} v${stt.metadata.version}`,
		);
		ctx.log.info(`     ${stt.metadata.description || ""}`);
		ctx.log.info(`     Local: ${stt.metadata.local ? "Yes" : "No (cloud)"}`);
	} else {
		ctx.log.info("  None installed");
	}

	ctx.log.info("\nTTS (Text-to-Speech):");
	if (tts) {
		ctx.log.info(
			`  ${tts.metadata.emoji || "🔊"} ${tts.metadata.name} v${tts.metadata.version}`,
		);
		ctx.log.info(`     ${tts.metadata.description || ""}`);
		ctx.log.info(`     Local: ${tts.metadata.local ? "Yes" : "No (cloud)"}`);
		ctx.log.info(`     Voices: ${tts.voices.length}`);
	} else {
		ctx.log.info("  None installed");
	}

	ctx.log.info("\n─".repeat(50));
	ctx.log.info(`Status: STT ${stt ? "✓" : "✗"} | TTS ${tts ? "✓" : "✗"}`);
}

// =============================================================================
// Plugin Export
// =============================================================================

const plugin: WOPRPlugin = {
	name: "voice-cli",
	version: "1.0.0",
	description: "CLI commands for voice transcription and synthesis",
	commands,

	async init(ctx: WOPRPluginContext) {
		ctx.log.info(
			"Voice CLI commands registered: wopr voice <transcribe|synthesize|list|providers>",
		);
	},
};

export default plugin;
