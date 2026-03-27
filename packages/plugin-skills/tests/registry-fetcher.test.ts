import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

vi.mock("../src/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../src/registries-repository.js", () => ({
  updateRegistryFetchStatus: vi.fn().mockResolvedValue(undefined),
}));

describe("registry-fetcher", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe("fetchRegistryManifest", () => {
    it("parses a valid registry manifest", async () => {
      const { fetchRegistryManifest } = await import("../src/registry-fetcher.js");
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            name: "test-registry",
            skills: [{ name: "skill-a", description: "A skill", source: "github:wopr/skills/a" }],
          }),
      }) as any;

      const result = await fetchRegistryManifest("https://example.com/registry.json");
      expect(result.skills).toHaveLength(1);
      expect(result.skills[0].name).toBe("skill-a");
    });

    it("throws on non-ok response", async () => {
      const { fetchRegistryManifest } = await import("../src/registry-fetcher.js");
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        statusText: "Not Found",
      }) as any;

      await expect(fetchRegistryManifest("https://example.com/bad")).rejects.toThrow("404");
    });

    it("throws on invalid JSON (missing skills array)", async () => {
      const { fetchRegistryManifest } = await import("../src/registry-fetcher.js");
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ name: "no-skills" }),
      }) as any;

      await expect(fetchRegistryManifest("https://example.com/bad")).rejects.toThrow("skills");
    });

    it("throws on network error", async () => {
      const { fetchRegistryManifest } = await import("../src/registry-fetcher.js");
      globalThis.fetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED")) as any;

      await expect(fetchRegistryManifest("https://example.com/down")).rejects.toThrow("ECONNREFUSED");
    });
  });

  describe("fetchAllRegistries", () => {
    it("aggregates skills from multiple registries", async () => {
      const { fetchAllRegistries } = await import("../src/registry-fetcher.js");
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            skills: [
              { name: "skill-a", description: "A", source: "github:a" },
              { name: "skill-b", description: "B", source: "github:b" },
            ],
          }),
      }) as any;

      const registries = [
        { id: "reg1", url: "https://one.com/r.json", addedAt: "2026-01-01T00:00:00Z" },
        { id: "reg2", url: "https://two.com/r.json", addedAt: "2026-01-01T00:00:00Z" },
      ];
      const result = await fetchAllRegistries(registries);
      expect(result.skills).toHaveLength(4);
      expect(result.errors).toHaveLength(0);
    });

    it("returns partial results when one registry fails", async () => {
      const { fetchAllRegistries } = await import("../src/registry-fetcher.js");
      let callCount = 0;
      globalThis.fetch = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ skills: [{ name: "skill-a", description: "A", source: "github:a" }] }),
          });
        }
        return Promise.reject(new Error("ECONNREFUSED"));
      }) as any;

      const registries = [
        { id: "good", url: "https://good.com/r.json", addedAt: "2026-01-01T00:00:00Z" },
        { id: "bad", url: "https://bad.com/r.json", addedAt: "2026-01-01T00:00:00Z" },
      ];
      const result = await fetchAllRegistries(registries);
      expect(result.skills).toHaveLength(1);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].registry).toBe("bad");
    });

    it("returns empty when no registries provided", async () => {
      const { fetchAllRegistries } = await import("../src/registry-fetcher.js");
      const result = await fetchAllRegistries([]);
      expect(result.skills).toEqual([]);
      expect(result.errors).toEqual([]);
    });
  });
});
