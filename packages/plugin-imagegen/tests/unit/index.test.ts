import { beforeEach, describe, expect, it, vi } from "vitest";
import plugin from "../../src/index.js";
import { createMockContext } from "../mocks/wopr-context.js";

function makeMockProvider(id: string) {
  return {
    id,
    registerCommand: vi.fn(),
    unregisterCommand: vi.fn(),
    type: "discord",
    send: vi.fn(),
    getInfo: vi.fn(),
  };
}

describe("plugin export", () => {
  it("exports a default object with name", () => {
    expect(plugin).toBeDefined();
    expect(plugin.name).toBe("@wopr-network/wopr-plugin-imagegen");
  });

  it("has correct version", () => {
    expect(plugin.version).toBe("1.0.0");
  });

  it("has a manifest with capabilities", () => {
    expect(plugin.manifest).toBeDefined();
    expect(plugin.manifest?.capabilities).toContain("image-generation");
  });

  it("manifest has lifecycle with shutdownBehavior and shutdownTimeoutMs", () => {
    expect(plugin.manifest?.lifecycle).toBeDefined();
    expect(plugin.manifest?.lifecycle?.shutdownBehavior).toBe("drain");
    expect(plugin.manifest?.lifecycle?.shutdownTimeoutMs).toBeGreaterThan(0);
  });

  it("manifest has icon, category, and tags", () => {
    expect(plugin.manifest?.icon).toBeDefined();
    expect(plugin.manifest?.category).toBe("creative");
    expect(plugin.manifest?.tags).toBeInstanceOf(Array);
  });

  it("manifest has provides.capabilities array", () => {
    expect(Array.isArray(plugin.manifest?.provides?.capabilities)).toBe(true);
  });
});

describe("plugin.init", () => {
  let mockCtx: ReturnType<typeof createMockContext>;

  beforeEach(() => {
    mockCtx = createMockContext();
  });

  it("registers config schema with correct plugin ID", async () => {
    await plugin.init!(mockCtx);
    expect(mockCtx.registerConfigSchema).toHaveBeenCalledWith(
      "wopr-plugin-imagegen",
      expect.any(Object),
    );
    await plugin.shutdown!();
  });

  it("registers A2A server with imagine tool", async () => {
    await plugin.init!(mockCtx);
    expect(mockCtx.registerA2AServer).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "imagegen",
        tools: expect.arrayContaining([
          expect.objectContaining({ name: "imagine" }),
        ]),
      }),
    );
    await plugin.shutdown!();
  });

  it("registers /imagine command on existing channel providers", async () => {
    const provider = makeMockProvider("discord-1");
    mockCtx.getChannelProviders = vi.fn().mockReturnValue([provider]);
    await plugin.init!(mockCtx);
    expect(provider.registerCommand).toHaveBeenCalledWith(
      expect.objectContaining({ name: "imagine" }),
    );
    await plugin.shutdown!();
  });

  it("handles no channel providers gracefully", async () => {
    mockCtx.getChannelProviders = vi.fn().mockReturnValue([]);
    await expect(plugin.init!(mockCtx)).resolves.not.toThrow();
    await plugin.shutdown!();
  });

  it("handles missing getChannelProviders gracefully", async () => {
    const ctxWithoutProviders = createMockContext();
    (ctxWithoutProviders as any).getChannelProviders = undefined;
    await expect(plugin.init!(ctxWithoutProviders)).resolves.not.toThrow();
    await plugin.shutdown!();
  });
});

describe("plugin.shutdown", () => {
  it("unregisters imagine command from channel providers", async () => {
    const provider = makeMockProvider("discord-1");
    const mockCtx = createMockContext({
      getChannelProviders: vi.fn().mockReturnValue([provider]),
    });
    await plugin.init!(mockCtx);
    await plugin.shutdown!();
    expect(provider.unregisterCommand).toHaveBeenCalledWith("imagine");
  });

  it("handles provider.unregisterCommand throwing without crashing", async () => {
    const provider = makeMockProvider("discord-1");
    provider.unregisterCommand.mockImplementation(() => {
      throw new Error("Provider already destroyed");
    });
    const mockCtx = createMockContext({
      getChannelProviders: vi.fn().mockReturnValue([provider]),
    });
    await plugin.init!(mockCtx);
    await expect(plugin.shutdown!()).resolves.not.toThrow();
  });
});

describe("A2A imagine tool handler", () => {
  it("calls inject with capability message and returns image content", async () => {
    const mockCtx = createMockContext();
    vi.mocked(mockCtx.inject).mockResolvedValue(
      JSON.stringify({ imageUrl: "https://example.com/generated.png" }),
    );

    await plugin.init!(mockCtx);

    // Get the registered A2A server tools
    const a2aCall = vi.mocked(mockCtx.registerA2AServer).mock.calls[0];
    const tools = a2aCall[0].tools;
    const imagineTool = tools.find((t: { name: string }) => t.name === "imagine");
    expect(imagineTool).toBeDefined();

    const result = await imagineTool!.handler({ prompt: "a dragon" });
    expect(result.isError).toBeFalsy();
    expect(result.content).toBeDefined();
    expect(mockCtx.inject).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining("[capability:image-generation]"),
      expect.any(Object),
    );

    await plugin.shutdown!();
  });

  it("returns error result when inject throws", async () => {
    const mockCtx = createMockContext();
    vi.mocked(mockCtx.inject).mockRejectedValue(new Error("Connection failed"));

    await plugin.init!(mockCtx);

    const a2aCall = vi.mocked(mockCtx.registerA2AServer).mock.calls[0];
    const tools = a2aCall[0].tools;
    const imagineTool = tools.find((t: { name: string }) => t.name === "imagine");

    const result = await imagineTool!.handler({ prompt: "a dragon" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("failed");

    await plugin.shutdown!();
  });

  it("registers late-joining channel providers via plugin:afterInit event", async () => {
    const mockCtx = createMockContext({
      getChannelProviders: vi.fn().mockReturnValue([]),
    });
    await plugin.init!(mockCtx);

    // Simulate a new provider arriving after init
    const lateProvider = makeMockProvider("slack-1");
    vi.mocked(mockCtx.getChannelProviders).mockReturnValue([lateProvider]);

    // Trigger the plugin:afterInit event
    const eventsOnCall = vi.mocked(mockCtx.events.on).mock.calls.find(
      (c) => c[0] === "plugin:afterInit",
    );
    expect(eventsOnCall).toBeDefined();
    const handler = eventsOnCall![1] as () => void;
    handler();
    expect(lateProvider.registerCommand).toHaveBeenCalledWith(
      expect.objectContaining({ name: "imagine" }),
    );

    await plugin.shutdown!();
  });
});
