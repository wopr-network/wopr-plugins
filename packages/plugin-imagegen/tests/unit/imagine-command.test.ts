import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleImagineCommand } from "../../src/imagine-command.js";
import type { ImageGenConfig } from "../../src/types.js";
import { createMockContext } from "../mocks/wopr-context.js";

function makeCmdCtx(args: string[], overrides: Record<string, unknown> = {}) {
  return {
    args,
    reply: vi.fn().mockResolvedValue(undefined),
    channel: "channel-123",
    channelType: "discord",
    sender: "user-abc",
    ...overrides,
  };
}

describe("handleImagineCommand", () => {
  let mockPluginCtx: ReturnType<typeof createMockContext>;
  const defaultConfig: ImageGenConfig = {
    defaultModel: "flux",
    defaultSize: "1024x1024",
    defaultStyle: "auto",
    maxPromptLength: 1000,
  };

  beforeEach(() => {
    mockPluginCtx = createMockContext();
  });

  it("replies with usage message when prompt is empty", async () => {
    const cmdCtx = makeCmdCtx([]);
    await handleImagineCommand(cmdCtx as any, mockPluginCtx, defaultConfig);
    expect(cmdCtx.reply).toHaveBeenCalledWith(
      expect.stringContaining("Please provide a prompt"),
    );
  });

  it("replies with usage message when args join to whitespace only", async () => {
    const cmdCtx = makeCmdCtx(["   "]);
    await handleImagineCommand(cmdCtx as any, mockPluginCtx, defaultConfig);
    expect(cmdCtx.reply).toHaveBeenCalledWith(
      expect.stringContaining("Please provide a prompt"),
    );
  });

  it("replies with length error when prompt exceeds maxPromptLength", async () => {
    const longPrompt = "a".repeat(1001);
    const cmdCtx = makeCmdCtx([longPrompt]);
    await handleImagineCommand(cmdCtx as any, mockPluginCtx, defaultConfig);
    expect(cmdCtx.reply).toHaveBeenCalledWith(
      expect.stringContaining("too long"),
    );
  });

  it("replies with size format error when --size is invalid", async () => {
    const cmdCtx = makeCmdCtx(["a cat", "--size", "big"]);
    await handleImagineCommand(cmdCtx as any, mockPluginCtx, defaultConfig);
    expect(cmdCtx.reply).toHaveBeenCalledWith(
      expect.stringContaining("Invalid size format"),
    );
  });

  it("replies with image URL when inject returns JSON with imageUrl", async () => {
    vi.mocked(mockPluginCtx.inject).mockResolvedValue(
      JSON.stringify({ imageUrl: "https://example.com/image.png" }),
    );
    const cmdCtx = makeCmdCtx(["a cat in a tuxedo"]);
    await handleImagineCommand(cmdCtx as any, mockPluginCtx, defaultConfig);
    expect(cmdCtx.reply).toHaveBeenCalledWith("https://example.com/image.png");
  });

  it("replies with image URL when inject returns plain URL string", async () => {
    vi.mocked(mockPluginCtx.inject).mockResolvedValue(
      "Here is your image: https://cdn.example.com/output.png generated!",
    );
    const cmdCtx = makeCmdCtx(["a cat"]);
    await handleImagineCommand(cmdCtx as any, mockPluginCtx, defaultConfig);
    expect(cmdCtx.reply).toHaveBeenCalledWith("https://cdn.example.com/output.png");
  });

  it("replies with credits message when inject returns insufficient_credits error", async () => {
    vi.mocked(mockPluginCtx.inject).mockResolvedValue(
      JSON.stringify({ error: "insufficient_credits" }),
    );
    const cmdCtx = makeCmdCtx(["a cat"]);
    await handleImagineCommand(cmdCtx as any, mockPluginCtx, defaultConfig);
    expect(cmdCtx.reply).toHaveBeenCalledWith(
      expect.stringContaining("credits"),
    );
  });

  it("replies with generic error message when inject returns an error", async () => {
    vi.mocked(mockPluginCtx.inject).mockResolvedValue(
      JSON.stringify({ error: "provider_unavailable" }),
    );
    const cmdCtx = makeCmdCtx(["a cat"]);
    await handleImagineCommand(cmdCtx as any, mockPluginCtx, defaultConfig);
    expect(cmdCtx.reply).toHaveBeenCalledWith(
      expect.stringContaining("Image generation failed"),
    );
  });

  it("replies with 'something went wrong' when inject throws", async () => {
    vi.mocked(mockPluginCtx.inject).mockRejectedValue(new Error("Network timeout"));
    const cmdCtx = makeCmdCtx(["a cat"]);
    await handleImagineCommand(cmdCtx as any, mockPluginCtx, defaultConfig);
    expect(cmdCtx.reply).toHaveBeenCalledWith(
      expect.stringContaining("Something went wrong"),
    );
  });

  it("applies config defaults when no flags specified", async () => {
    vi.mocked(mockPluginCtx.inject).mockResolvedValue(
      JSON.stringify({ imageUrl: "https://example.com/img.png" }),
    );
    const cmdCtx = makeCmdCtx(["a cat"]);
    await handleImagineCommand(cmdCtx as any, mockPluginCtx, defaultConfig);

    expect(mockPluginCtx.inject).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining("model: flux"),
      expect.any(Object),
    );
    expect(mockPluginCtx.inject).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining("size: 1024x1024"),
      expect.any(Object),
    );
    expect(mockPluginCtx.inject).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining("style: auto"),
      expect.any(Object),
    );
  });

  it("uses flags over config defaults when flags are specified", async () => {
    vi.mocked(mockPluginCtx.inject).mockResolvedValue(
      JSON.stringify({ imageUrl: "https://example.com/img.png" }),
    );
    const cmdCtx = makeCmdCtx(["a cat", "--model", "sdxl", "--size", "512x512", "--style", "anime"]);
    await handleImagineCommand(cmdCtx as any, mockPluginCtx, defaultConfig);

    expect(mockPluginCtx.inject).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining("model: sdxl"),
      expect.any(Object),
    );
    expect(mockPluginCtx.inject).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining("size: 512x512"),
      expect.any(Object),
    );
    expect(mockPluginCtx.inject).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining("style: anime"),
      expect.any(Object),
    );
  });

  it("uses channel-specific session key for inject", async () => {
    vi.mocked(mockPluginCtx.inject).mockResolvedValue(
      JSON.stringify({ imageUrl: "https://example.com/img.png" }),
    );
    const cmdCtx = makeCmdCtx(["a cat"], { channelType: "slack", channel: "C123ABC" });
    await handleImagineCommand(cmdCtx as any, mockPluginCtx, defaultConfig);

    expect(mockPluginCtx.inject).toHaveBeenCalledWith(
      "imagegen:slack:C123ABC",
      expect.any(String),
      expect.any(Object),
    );
  });

  it("includes capability marker in inject message", async () => {
    vi.mocked(mockPluginCtx.inject).mockResolvedValue(
      JSON.stringify({ imageUrl: "https://example.com/img.png" }),
    );
    const cmdCtx = makeCmdCtx(["a beautiful sunset"]);
    await handleImagineCommand(cmdCtx as any, mockPluginCtx, defaultConfig);

    expect(mockPluginCtx.inject).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining("[capability:image-generation]"),
      expect.any(Object),
    );
    expect(mockPluginCtx.inject).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining("prompt: a beautiful sunset"),
      expect.any(Object),
    );
  });
});
