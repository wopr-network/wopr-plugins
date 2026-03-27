export interface PiperTTSConfig {
	/** Docker image to use */
	image?: string;
	/** Default voice model */
	voice?: string;
	/** Sample rate (Hz) */
	sampleRate?: number;
	/** Speed multiplier (0.5 - 2.0) */
	speed?: number;
	/** Model cache directory on host (optional) */
	modelCachePath?: string;
}

export const DEFAULT_CONFIG: Required<Omit<PiperTTSConfig, "modelCachePath">> =
	{
		image: "rhasspy/piper:latest",
		voice: "en_US-lessac-medium",
		sampleRate: 22050,
		speed: 1.0,
	};
