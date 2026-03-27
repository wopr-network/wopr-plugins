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

  // Validate configuration
  try {
    provider.validateConfig();
  } catch (error) {
    console.error("✗ Configuration invalid:", error);
    return;
  }

  // Health check
  const healthy = await provider.healthCheck();

  if (!healthy) {
    console.error("API is not accessible, exiting");
    return;
  }
  const voices = await provider.fetchVoices();
  voices.slice(0, 5).forEach((voice) => {
    if (voice.description) {
    }
  });
  const text1 = "Hello! This is a test of the ElevenLabs text-to-speech system.";
  const result = await provider.synthesize(text1, {
    voice: "21m00Tcm4TlvDq8ikWAM",
    speed: 1.0,
    format: "pcm_s16le",
  });

  // Save to file
  const outputPath = path.join(process.cwd(), "output-batch.raw");
  fs.writeFileSync(outputPath, result.audio);
  const text2 =
    "This is a longer text that demonstrates streaming synthesis. " +
    "The audio will be generated and delivered in chunks, allowing for " +
    "low-latency playback. This is ideal for real-time voice applications.";

  const chunks: Buffer[] = [];
  let _chunkCount = 0;

  for await (const chunk of provider.streamSynthesize(text2, {
    voice: "21m00Tcm4TlvDq8ikWAM",
    speed: 1.1,
  })) {
    _chunkCount++;
    chunks.push(chunk);
  }

  const _totalBytes = chunks.reduce((sum, chunk) => sum + chunk.length, 0);

  // Save streamed audio
  const streamOutputPath = path.join(process.cwd(), "output-stream.raw");
  fs.writeFileSync(streamOutputPath, Buffer.concat(chunks));
  const text3 = "Testing different voice parameters for expressive speech.";

  const _result2 = await provider.synthesize(text3, {
    voice: "EXAVITQu4vr4xnSDxMaL", // Bella
    speed: 0.9,
    format: "pcm_s16le",
  });
}

main().catch(console.error);
