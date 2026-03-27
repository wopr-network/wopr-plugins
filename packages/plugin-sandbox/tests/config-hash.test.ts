import { describe, it, expect } from "vitest";
import { computeSandboxConfigHash } from "../src/config-hash.js";
import type { SandboxDockerConfig } from "../src/types.docker.js";

function makeDockerConfig(overrides?: Partial<SandboxDockerConfig>): SandboxDockerConfig {
  return {
    image: "test:latest",
    containerPrefix: "test-",
    workdir: "/workspace",
    readOnlyRoot: true,
    tmpfs: ["/tmp"],
    network: "none",
    capDrop: ["ALL"],
    ...overrides,
  };
}

describe("config-hash", () => {
  describe("computeSandboxConfigHash", () => {
    it("returns a hex string", () => {
      const hash = computeSandboxConfigHash({
        docker: makeDockerConfig(),
        workspaceAccess: "none",
        workspaceDir: "/test",
      });
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it("is deterministic for same input", () => {
      const input = {
        docker: makeDockerConfig(),
        workspaceAccess: "none" as const,
        workspaceDir: "/test",
      };
      const a = computeSandboxConfigHash(input);
      const b = computeSandboxConfigHash(input);
      expect(a).toBe(b);
    });

    it("changes when image changes", () => {
      const a = computeSandboxConfigHash({
        docker: makeDockerConfig({ image: "a:latest" }),
        workspaceAccess: "none",
        workspaceDir: "/test",
      });
      const b = computeSandboxConfigHash({
        docker: makeDockerConfig({ image: "b:latest" }),
        workspaceAccess: "none",
        workspaceDir: "/test",
      });
      expect(a).not.toBe(b);
    });

    it("changes when workspaceAccess changes", () => {
      const a = computeSandboxConfigHash({
        docker: makeDockerConfig(),
        workspaceAccess: "none",
        workspaceDir: "/test",
      });
      const b = computeSandboxConfigHash({
        docker: makeDockerConfig(),
        workspaceAccess: "ro",
        workspaceDir: "/test",
      });
      expect(a).not.toBe(b);
    });

    it("changes when workspaceDir changes", () => {
      const a = computeSandboxConfigHash({
        docker: makeDockerConfig(),
        workspaceAccess: "none",
        workspaceDir: "/path/a",
      });
      const b = computeSandboxConfigHash({
        docker: makeDockerConfig(),
        workspaceAccess: "none",
        workspaceDir: "/path/b",
      });
      expect(a).not.toBe(b);
    });

    it("is order-independent for object keys", () => {
      // The normalizeForHash function sorts object keys
      const docker1: SandboxDockerConfig = {
        image: "test",
        containerPrefix: "p-",
        workdir: "/w",
        readOnlyRoot: true,
        tmpfs: ["/tmp"],
        network: "none",
        capDrop: ["ALL"],
        memory: "512m",
        cpus: 0.5,
      };
      const docker2: SandboxDockerConfig = {
        cpus: 0.5,
        memory: "512m",
        capDrop: ["ALL"],
        network: "none",
        tmpfs: ["/tmp"],
        readOnlyRoot: true,
        workdir: "/w",
        containerPrefix: "p-",
        image: "test",
      };
      const a = computeSandboxConfigHash({
        docker: docker1,
        workspaceAccess: "none",
        workspaceDir: "/test",
      });
      const b = computeSandboxConfigHash({
        docker: docker2,
        workspaceAccess: "none",
        workspaceDir: "/test",
      });
      expect(a).toBe(b);
    });

    it("is order-independent for primitive arrays", () => {
      const a = computeSandboxConfigHash({
        docker: makeDockerConfig({ capDrop: ["ALL", "NET_RAW"] }),
        workspaceAccess: "none",
        workspaceDir: "/test",
      });
      const b = computeSandboxConfigHash({
        docker: makeDockerConfig({ capDrop: ["NET_RAW", "ALL"] }),
        workspaceAccess: "none",
        workspaceDir: "/test",
      });
      expect(a).toBe(b);
    });

    it("ignores undefined values", () => {
      const a = computeSandboxConfigHash({
        docker: makeDockerConfig({ user: undefined }),
        workspaceAccess: "none",
        workspaceDir: "/test",
      });
      const b = computeSandboxConfigHash({
        docker: makeDockerConfig(),
        workspaceAccess: "none",
        workspaceDir: "/test",
      });
      expect(a).toBe(b);
    });

    it("changes when env changes", () => {
      const a = computeSandboxConfigHash({
        docker: makeDockerConfig({ env: { FOO: "bar" } }),
        workspaceAccess: "none",
        workspaceDir: "/test",
      });
      const b = computeSandboxConfigHash({
        docker: makeDockerConfig({ env: { FOO: "baz" } }),
        workspaceAccess: "none",
        workspaceDir: "/test",
      });
      expect(a).not.toBe(b);
    });
  });
});
