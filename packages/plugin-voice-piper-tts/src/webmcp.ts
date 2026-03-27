/**
 * WebMCP tool registration for Piper TTS.
 * Exposes getStatus, listVoices as read-only browser tools.
 */

interface VoiceEntry {
	id: string;
	name: string;
	language?: string;
	gender?: string;
	description?: string;
}

interface PiperProvider {
	readonly metadata: {
		name: string;
		type: string;
		version: string;
		description: string;
		local: boolean;
		capabilities: string[];
	};
	readonly voices: VoiceEntry[];
	healthCheck(): Promise<boolean>;
}

export function getWebMCPToolDeclarations() {
	return [
		{
			name: "piper-tts.getStatus",
			description: "Get status of the Piper local TTS provider",
			inputSchema: { type: "object", properties: {} },
			annotations: { readOnlyHint: true },
		},
		{
			name: "piper-tts.listVoices",
			description: "List available Piper TTS voices",
			inputSchema: {
				type: "object",
				properties: {
					language: {
						type: "string",
						description:
							"Filter by language code (e.g. 'en-US'). Omit for all.",
					},
				},
			},
			annotations: { readOnlyHint: true },
		},
	];
}

export function getWebMCPHandlers(
	provider: PiperProvider,
): Record<string, (input: Record<string, unknown>) => Promise<unknown>> {
	return {
		"piper-tts.getStatus": async (_input) => ({
			provider: provider.metadata.name,
			type: provider.metadata.type,
			version: provider.metadata.version,
			description: provider.metadata.description,
			local: provider.metadata.local,
			capabilities: provider.metadata.capabilities,
			healthy: await provider.healthCheck(),
			voiceCount: provider.voices.length,
		}),

		"piper-tts.listVoices": async (input) => {
			let voices = [...provider.voices];
			const lang = input.language as string | undefined;
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
	};
}
