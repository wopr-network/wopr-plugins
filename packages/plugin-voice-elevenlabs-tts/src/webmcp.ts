/**
 * WebMCP tool registration for ElevenLabs TTS.
 * Exposes getStatus, listVoices, listModels as read-only browser tools.
 */

import type { ElevenLabsTTSProvider } from "./index.js";

/** Known ElevenLabs TTS models */
const ELEVENLABS_MODELS = [
	{
		id: "eleven_v3",
		name: "Eleven v3",
		description: "Latest model with highest quality",
	},
	{
		id: "eleven_turbo_v2_5",
		name: "Eleven Turbo v2.5",
		description: "Fast, high quality (recommended)",
	},
	{
		id: "eleven_turbo_v2",
		name: "Eleven Turbo v2",
		description: "Fast generation",
	},
	{
		id: "eleven_monolingual_v1",
		name: "Eleven Monolingual v1",
		description: "English only",
	},
	{
		id: "eleven_multilingual_v2",
		name: "Eleven Multilingual v2",
		description: "Multi-language support",
	},
	{
		id: "eleven_multilingual_v1",
		name: "Eleven Multilingual v1",
		description: "Legacy multi-language",
	},
];

/**
 * Build WebMCP tool declarations for this plugin's manifest.
 */
export function getWebMCPToolDeclarations() {
	return [
		{
			name: "elevenlabs-tts.getStatus",
			description: "Get status of the ElevenLabs TTS provider",
			inputSchema: { type: "object", properties: {} },
			annotations: { readOnlyHint: true },
		},
		{
			name: "elevenlabs-tts.listVoices",
			description: "List available ElevenLabs TTS voices",
			inputSchema: {
				type: "object",
				properties: {
					language: {
						type: "string",
						description: "Filter by language code (e.g. 'en'). Omit for all.",
					},
				},
			},
			annotations: { readOnlyHint: true },
		},
		{
			name: "elevenlabs-tts.listModels",
			description: "List available ElevenLabs TTS models",
			inputSchema: { type: "object", properties: {} },
			annotations: { readOnlyHint: true },
		},
	];
}

/**
 * Build WebMCP tool handlers that close over the live provider instance.
 * SECURITY: Never expose config.apiKey or any credential.
 */
export function getWebMCPHandlers(
	provider: ElevenLabsTTSProvider,
	currentModelId: string,
): Record<string, (input: Record<string, unknown>) => Promise<unknown>> {
	return {
		"elevenlabs-tts.getStatus": async () => ({
			provider: provider.metadata.name,
			type: provider.metadata.type,
			version: provider.metadata.version,
			description: provider.metadata.description,
			local: provider.metadata.local,
			capabilities: provider.metadata.capabilities,
			healthy: await provider.healthCheck(),
			voiceCount: provider.voices.length,
		}),

		"elevenlabs-tts.listVoices": async (input) => {
			let voices = provider.voices;
			if (voices.length === 0) {
				voices = await provider.fetchVoices();
			}
			const lang =
				typeof input.language === "string" ? input.language : undefined;
			if (lang) {
				voices = voices.filter((v) =>
					v.language?.toLowerCase().startsWith(lang.toLowerCase()),
				);
			}
			return {
				provider: provider.metadata.name,
				count: voices.length,
				voices: voices.map((v) => ({
					id: v.id,
					name: v.name,
					language: v.language ?? null,
					gender: v.gender ?? null,
					description: v.description ?? null,
				})),
			};
		},

		"elevenlabs-tts.listModels": async () => ({
			provider: provider.metadata.name,
			models: ELEVENLABS_MODELS,
			currentModel: currentModelId,
		}),
	};
}
