/**
 * Example usage of ElevenLabs TTS provider
 *
 * Run with: node --loader ts-node/esm src/example.ts
 */

import fs from "node:fs";
import path from "node:path";
import { ElevenLabsTTSProvider } from "./index.js";

async function main() {
	// Initialize provider
	const provider = new ElevenLabsTTSProvider({
		apiKey: process.env.ELEVENLABS_API_KEY,
		defaultVoiceId: "21m00Tcm4TlvDq8ikWAM", // Rachel
		defaultModelId: "eleven_turbo_v2_5",
		stability: 0.5,
		similarityBoost: 0.75,
		speakerBoost: true,
	});

	console.log("ElevenLabs TTS Provider initialized");
	console.log("Metadata:", provider.metadata);

	// Validate configuration
	try {
		provider.validateConfig();
		console.log("✓ Configuration valid");
	} catch (error) {
		console.error("✗ Configuration invalid:", error);
		return;
	}

	// Health check
	const healthy = await provider.healthCheck();
	console.log(`Health check: ${healthy ? "✓ OK" : "✗ Failed"}`);

	if (!healthy) {
		console.error("API is not accessible, exiting");
		return;
	}

	// Fetch available voices
	console.log("\nFetching available voices...");
	const voices = await provider.fetchVoices();
	console.log(`Found ${voices.length} voices:`);
	voices.slice(0, 5).forEach((voice) => {
		console.log(`  - ${voice.name} (${voice.id})`);
		if (voice.description) {
			console.log(`    ${voice.description}`);
		}
	});

	// Example 1: Batch synthesis
	console.log("\n--- Example 1: Batch Synthesis ---");
	const text1 =
		"Hello! This is a test of the ElevenLabs text-to-speech system.";
	const result = await provider.synthesize(text1, {
		voice: "21m00Tcm4TlvDq8ikWAM",
		speed: 1.0,
		format: "pcm_s16le",
	});

	console.log(`Synthesized ${result.audio.length} bytes`);
	console.log(`Format: ${result.format}, Sample rate: ${result.sampleRate}Hz`);
	console.log(`Duration: ~${Math.round(result.durationMs)}ms`);

	// Save to file
	const outputPath = path.join(process.cwd(), "output-batch.raw");
	fs.writeFileSync(outputPath, result.audio);
	console.log(`Saved to ${outputPath}`);

	// Example 2: Streaming synthesis
	console.log("\n--- Example 2: Streaming Synthesis ---");
	const text2 =
		"This is a longer text that demonstrates streaming synthesis. " +
		"The audio will be generated and delivered in chunks, allowing for " +
		"low-latency playback. This is ideal for real-time voice applications.";

	const chunks: Buffer[] = [];
	let chunkCount = 0;

	for await (const chunk of provider.streamSynthesize(text2, {
		voice: "21m00Tcm4TlvDq8ikWAM",
		speed: 1.1,
	})) {
		chunkCount++;
		chunks.push(chunk);
		console.log(`  Received chunk ${chunkCount}: ${chunk.length} bytes`);
	}

	const totalBytes = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
	console.log(`Received ${chunkCount} chunks, ${totalBytes} total bytes`);

	// Save streamed audio
	const streamOutputPath = path.join(process.cwd(), "output-stream.raw");
	fs.writeFileSync(streamOutputPath, Buffer.concat(chunks));
	console.log(`Saved to ${streamOutputPath}`);

	// Example 3: Different voice parameters
	console.log("\n--- Example 3: Voice Parameters ---");
	const text3 = "Testing different voice parameters for expressive speech.";

	const result2 = await provider.synthesize(text3, {
		voice: "EXAVITQu4vr4xnSDxMaL", // Bella
		speed: 0.9,
		format: "pcm_s16le",
	});

	console.log(
		`Synthesized with different voice: ${result2.audio.length} bytes`,
	);

	console.log("\n✓ All examples completed successfully");
	console.log("\nTo play the audio files (raw PCM):");
	console.log("  ffplay -f s16le -ar 44100 -ac 1 output-batch.raw");
	console.log("  ffplay -f s16le -ar 44100 -ac 1 output-stream.raw");
}

main().catch(console.error);
