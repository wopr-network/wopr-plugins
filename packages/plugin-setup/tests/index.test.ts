import { beforeEach, describe, expect, it, vi } from "vitest";

describe("wopr-plugin-setup", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let plugin: any;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import("../src/index.js");
    plugin = mod.default;
  });

  it("exports a valid WOPRPlugin", () => {
    expect(plugin.name).toBe("wopr-plugin-setup");
    expect(plugin.version).toBe("0.1.0");
    expect(typeof plugin.init).toBe("function");
    expect(typeof plugin.shutdown).toBe("function");
  });

  it("registers A2A server and extension on init", async () => {
    const registerA2AServer = vi.fn();
    const registerExtension = vi.fn();
    const ctx = {
      registerA2AServer,
      registerExtension,
      getConfig: () => ({}),
      saveConfig: vi.fn(),
      events: { emit: vi.fn() },
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    };

    await plugin.init(ctx);

    expect(registerA2AServer).toHaveBeenCalledTimes(1);
    expect(registerA2AServer.mock.calls[0][0].name).toBe("setup");
    expect(registerA2AServer.mock.calls[0][0].tools).toHaveLength(7);

    expect(registerExtension).toHaveBeenCalledWith(
      "setup",
      expect.objectContaining({
        beginSetup: expect.any(Function),
        getSession: expect.any(Function),
        isSetupActive: expect.any(Function),
      }),
    );
  });

  it("unregisters on shutdown", async () => {
    const unregisterExtension = vi.fn();
    const ctx = {
      registerA2AServer: vi.fn(),
      registerExtension: vi.fn(),
      unregisterExtension,
      getConfig: () => ({}),
      saveConfig: vi.fn(),
      events: { emit: vi.fn() },
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    };

    await plugin.init(ctx);
    await plugin.shutdown();

    expect(unregisterExtension).toHaveBeenCalledWith("setup");
  });

  it("extension beginSetup creates a retrievable session", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let capturedExtension: any;
    const ctx = {
      registerA2AServer: vi.fn(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      registerExtension: vi.fn((name: string, ext: any) => {
        capturedExtension = ext;
      }),
      getConfig: () => ({}),
      saveConfig: vi.fn(),
      events: { emit: vi.fn() },
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    };

    await plugin.init(ctx);
    await capturedExtension.beginSetup("test-plugin", { title: "Test", fields: [] }, "sess-99");

    expect(capturedExtension.isSetupActive("sess-99")).toBe(true);
    const session = capturedExtension.getSession("sess-99");
    expect(session.pluginId).toBe("test-plugin");
  });
});
