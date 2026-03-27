import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock global fetch before importing the module
const mockFetch = vi.fn();
global.fetch = mockFetch as unknown as typeof fetch;

// We need to import after mocking
const { default: plugin, ChatterboxProvider, wavToPcm } = await import("../src/index.js");

// Helper: create a minimal WAV buffer
function makeWavBuffer(pcmBytes: number): Buffer {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcmBytes, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16); // chunk size
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(24000, 24); // sample rate
  header.writeUInt32LE(48000, 28); // byte rate
  header.writeUInt16LE(2, 32); // block align
  header.writeUInt16LE(16, 34); // bits per sample
  header.write("data", 36);
  header.writeUInt32LE(pcmBytes, 40);
  return Buffer.concat([header, Buffer.alloc(pcmBytes)]);
}

interface MockLog {
  info: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
  warn: ReturnType<typeof vi.fn>;
  debug: ReturnType<typeof vi.fn>;
}

interface MockCtx {
  log: MockLog;
  getConfig: () => { serverUrl: string };
  registerExtension: ReturnType<typeof vi.fn>;
  registerProvider: ReturnType<typeof vi.fn>;
}

interface SynthesizeResult {
  format: string;
  sampleRate: number;
}

interface MockProvider {
  synthesize(text: string, opts?: Record<string, unknown>): Promise<SynthesizeResult>;
}

function mockCtx(): MockCtx {
  return {
    log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
    getConfig: () => ({ serverUrl: "http://localhost:5123" }),
    registerExtension: vi.fn(),
    registerProvider: vi.fn(),
  };
}

function makeArrayBuffer(buf: Buffer): ArrayBuffer {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

describe("wavToPcm", () => {
  it("should extract PCM data and sample rate from a valid WAV buffer", () => {
    const wavBuf = makeWavBuffer(4);
    const result = wavToPcm(wavBuf);
    expect(result.sampleRate).toBe(24000);
    expect(result.pcm.length).toBe(4);
  });

  it("should return default sample rate for a too-small buffer", () => {
    const buf = Buffer.alloc(10);
    const result = wavToPcm(buf);
    expect(result.sampleRate).toBe(24000);
    expect(result.pcm.length).toBe(0);
  });

  it("should fall back to 44-byte offset for buffers without a valid data chunk", () => {
    // RIFF header with no valid chunks
    const buf = Buffer.alloc(50);
    buf.write("RIFF", 0);
    buf.writeUInt32LE(42, 4);
    buf.write("WAVE", 8);
    // Write a chunk with large size to skip past end
    buf.write("junk", 12);
    buf.writeUInt32LE(1000, 16);

    const result = wavToPcm(buf);
    // Falls back to subarray(44)
    expect(result.pcm.length).toBe(6);
  });
});

describe("ChatterboxProvider", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("should create with correct metadata", () => {
    const provider = new ChatterboxProvider();
    expect(provider.metadata.name).toBe("chatterbox");
    expect(provider.metadata.type).toBe("tts");
    expect(provider.metadata.local).toBe(true);
    expect(provider.voices).toHaveLength(1);
    expect(provider.voices[0].id).toBe("default");
  });

  it("validateConfig should not throw with a valid serverUrl", () => {
    const provider = new ChatterboxProvider({ serverUrl: "http://custom:9999" });
    expect(() => provider.validateConfig()).not.toThrow();
  });

  it("validateConfig should throw if serverUrl is empty string", () => {
    const provider = new ChatterboxProvider({ serverUrl: "" });
    expect(() => provider.validateConfig()).toThrow("serverUrl is required");
  });

  it("healthCheck should return false when server is unreachable", async () => {
    const provider = new ChatterboxProvider({ serverUrl: "http://localhost:1" });
    const result = await provider.healthCheck();
    expect(result).toBe(false);
  });

  it("shutdown should resolve without error", async () => {
    const provider = new ChatterboxProvider();
    await expect(provider.shutdown()).resolves.toBeUndefined();
  });

  it("synthesizes without referenceAudio (OpenAI-compat endpoint)", async () => {
    const wavBuf = makeWavBuffer(100);

    // Health check
    mockFetch.mockResolvedValueOnce({ ok: true });
    // Voices
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => [] });
    // Synthesize
    mockFetch.mockResolvedValueOnce({
      ok: true,
      arrayBuffer: async () => makeArrayBuffer(wavBuf),
    });

    const ctx = mockCtx();
    await plugin.init?.(ctx as Parameters<NonNullable<typeof plugin.init>>[0]);

    const provider = ctx.registerExtension.mock.calls[0][1] as MockProvider;
    const result = await provider.synthesize("Hello world");

    expect(result.format).toBe("pcm_s16le");
    expect(result.sampleRate).toBe(24000);

    const synthCall = mockFetch.mock.calls[2];
    expect(synthCall[0]).toContain("/v1/audio/speech");
  });

  it("synthesizes with referenceAudio (cloning path)", async () => {
    const wavBuf = makeWavBuffer(100);
    const refAudio = Buffer.from("fake-reference-audio");

    mockFetch.mockResolvedValueOnce({ ok: true });
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => [] });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      arrayBuffer: async () => makeArrayBuffer(wavBuf),
    });

    const ctx = mockCtx();
    await plugin.init?.(ctx as Parameters<NonNullable<typeof plugin.init>>[0]);

    const provider = ctx.registerExtension.mock.calls[0][1] as MockProvider;
    const result = await provider.synthesize("Hello clone", { referenceAudio: refAudio });

    expect(result.format).toBe("pcm_s16le");

    const synthCall = mockFetch.mock.calls[2];
    expect(synthCall[0]).toContain("/synthesize");
    expect(synthCall[1].body).toBeInstanceOf(FormData);
  });
});

describe("plugin", () => {
  it("should export default plugin with correct metadata", () => {
    expect(plugin.name).toBe("voice-chatterbox");
    expect(plugin.version).toBe("1.0.0");
    expect(plugin.init).toBeTypeOf("function");
    expect(plugin.shutdown).toBeTypeOf("function");
  });

  it("shutdown should handle no active provider gracefully", async () => {
    await expect(plugin.shutdown!()).resolves.toBeUndefined();
  });

  it("registers TTS provider via registerExtension and registerProvider on init", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true });
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => [] });

    const ctx = mockCtx();
    await plugin.init?.(ctx as Parameters<NonNullable<typeof plugin.init>>[0]);

    expect(ctx.registerExtension).toHaveBeenCalledWith("tts", expect.any(Object));
    expect(ctx.registerProvider).toHaveBeenCalled();
  });
});
