import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import plugin from "../src/index.js";

function createMockCtx() {
  return {
    registerContextProvider: vi.fn(),
    unregisterContextProvider: vi.fn(),
    log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  } as any;
}

describe("wopr-plugin-superpower-company", () => {
  let mockCtx: ReturnType<typeof createMockCtx>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockCtx = createMockCtx();
  });

  describe("plugin metadata", () => {
    it("has correct name", () => {
      expect(plugin.name).toBe("wopr-plugin-superpower-company");
    });

    it("has correct version", () => {
      expect(plugin.version).toBe("1.0.0");
    });

    it("has a description", () => {
      expect(plugin.description).toBeDefined();
    });
  });

  describe("manifest", () => {
    it("has category superpower", () => {
      expect(plugin.manifest?.category).toBe("superpower");
    });

    it("declares dependencies on cron, gmail, discord, skills", () => {
      expect(plugin.manifest?.dependencies).toEqual([
        "@wopr-network/wopr-plugin-cron",
        "@wopr-network/wopr-plugin-gmail",
        "@wopr-network/wopr-plugin-discord",
        "@wopr-network/wopr-plugin-skills",
      ]);
    });

    it("has marketplace pitch pointing to SUPERPOWER.md", () => {
      expect((plugin.manifest as any)?.marketplace?.pitch).toBe("./SUPERPOWER.md");
    });

    it("has setup steps", () => {
      expect(plugin.manifest?.setup).toHaveLength(3);
      expect(plugin.manifest?.setup?.[0].id).toBe("welcome");
      expect(plugin.manifest?.setup?.[1].id).toBe("discord");
      expect(plugin.manifest?.setup?.[2].id).toBe("gmail");
    });

    it("has icon", () => {
      expect(plugin.manifest?.icon).toBeDefined();
    });
  });

  describe("init()", () => {
    it("registers persona context provider", async () => {
      await plugin.init!(mockCtx);
      expect(mockCtx.registerContextProvider).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "superpower-company",
          priority: 90,
          enabled: true,
        }),
      );
    });

    it("context provider returns persona with system role", async () => {
      await plugin.init!(mockCtx);
      const provider = mockCtx.registerContextProvider.mock.calls[0][0];
      const result = await provider.getContext("session-1", { content: "hi", from: "user", timestamp: Date.now() });
      expect(result).toEqual({
        content: expect.stringContaining("dedicated employee"),
        role: "system",
        metadata: { source: "superpower-company", priority: 90 },
      });
    });
  });

  describe("shutdown()", () => {
    it("unregisters context provider after init", async () => {
      await plugin.init!(mockCtx);
      await plugin.shutdown!();
      expect(mockCtx.unregisterContextProvider).toHaveBeenCalledWith("superpower-company");
    });

    it("does not throw when called without init", async () => {
      await plugin.shutdown!();
    });
  });
});
