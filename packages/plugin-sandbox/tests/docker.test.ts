import { describe, expect, it } from "vitest";
import { buildSandboxCreateArgs, execInContainerRaw } from "../src/docker.js";
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

describe("docker", () => {
  describe("buildSandboxCreateArgs", () => {
    it("includes container name", () => {
      const args = buildSandboxCreateArgs({
        name: "my-container",
        cfg: makeDockerConfig(),
        scopeKey: "test",
      });
      expect(args).toContain("create");
      expect(args).toContain("--name");
      expect(args).toContain("my-container");
    });

    it("includes sandbox label", () => {
      const args = buildSandboxCreateArgs({
        name: "c1",
        cfg: makeDockerConfig(),
        scopeKey: "test",
      });
      expect(args).toContain("--label");
      expect(args).toContain("wopr.sandbox=1");
    });

    it("includes session key label", () => {
      const args = buildSandboxCreateArgs({
        name: "c1",
        cfg: makeDockerConfig(),
        scopeKey: "my-session",
      });
      expect(args).toContain("wopr.sessionKey=my-session");
    });

    it("includes config hash label when provided", () => {
      const args = buildSandboxCreateArgs({
        name: "c1",
        cfg: makeDockerConfig(),
        scopeKey: "test",
        configHash: "abc123",
      });
      expect(args).toContain("wopr.configHash=abc123");
    });

    it("omits config hash label when not provided", () => {
      const args = buildSandboxCreateArgs({
        name: "c1",
        cfg: makeDockerConfig(),
        scopeKey: "test",
      });
      const configHashArg = args.find((a) => a.startsWith("wopr.configHash="));
      expect(configHashArg).toBeUndefined();
    });

    it("includes --read-only when readOnlyRoot is true", () => {
      const args = buildSandboxCreateArgs({
        name: "c1",
        cfg: makeDockerConfig({ readOnlyRoot: true }),
        scopeKey: "test",
      });
      expect(args).toContain("--read-only");
    });

    it("omits --read-only when readOnlyRoot is false", () => {
      const args = buildSandboxCreateArgs({
        name: "c1",
        cfg: makeDockerConfig({ readOnlyRoot: false }),
        scopeKey: "test",
      });
      expect(args).not.toContain("--read-only");
    });

    it("includes tmpfs mounts", () => {
      const args = buildSandboxCreateArgs({
        name: "c1",
        cfg: makeDockerConfig({ tmpfs: ["/tmp", "/var/tmp"] }),
        scopeKey: "test",
      });
      const tmpfsArgs = args.filter((_, i) => args[i - 1] === "--tmpfs");
      expect(tmpfsArgs).toContain("/tmp");
      expect(tmpfsArgs).toContain("/var/tmp");
    });

    it("includes network setting", () => {
      const args = buildSandboxCreateArgs({
        name: "c1",
        cfg: makeDockerConfig({ network: "bridge" }),
        scopeKey: "test",
      });
      expect(args).toContain("--network");
      expect(args).toContain("bridge");
    });

    it("includes user when specified", () => {
      const args = buildSandboxCreateArgs({
        name: "c1",
        cfg: makeDockerConfig({ user: "1000:1000" }),
        scopeKey: "test",
      });
      expect(args).toContain("--user");
      expect(args).toContain("1000:1000");
    });

    it("omits user when not specified", () => {
      const args = buildSandboxCreateArgs({
        name: "c1",
        cfg: makeDockerConfig(),
        scopeKey: "test",
      });
      expect(args).not.toContain("--user");
    });

    it("includes cap-drop entries", () => {
      const args = buildSandboxCreateArgs({
        name: "c1",
        cfg: makeDockerConfig({ capDrop: ["ALL", "NET_RAW"] }),
        scopeKey: "test",
      });
      const capDropArgs = args.filter((_, i) => args[i - 1] === "--cap-drop");
      expect(capDropArgs).toContain("ALL");
      expect(capDropArgs).toContain("NET_RAW");
    });

    it("always includes no-new-privileges", () => {
      const args = buildSandboxCreateArgs({
        name: "c1",
        cfg: makeDockerConfig(),
        scopeKey: "test",
      });
      expect(args).toContain("--security-opt");
      expect(args).toContain("no-new-privileges");
    });

    it("includes seccomp profile when specified", () => {
      const args = buildSandboxCreateArgs({
        name: "c1",
        cfg: makeDockerConfig({ seccompProfile: "/path/to/profile.json" }),
        scopeKey: "test",
      });
      expect(args).toContain("seccomp=/path/to/profile.json");
    });

    it("includes apparmor profile when specified", () => {
      const args = buildSandboxCreateArgs({
        name: "c1",
        cfg: makeDockerConfig({ apparmorProfile: "docker-default" }),
        scopeKey: "test",
      });
      expect(args).toContain("apparmor=docker-default");
    });

    it("includes dns entries", () => {
      const args = buildSandboxCreateArgs({
        name: "c1",
        cfg: makeDockerConfig({ dns: ["8.8.8.8", "1.1.1.1"] }),
        scopeKey: "test",
      });
      const dnsArgs = args.filter((_, i) => args[i - 1] === "--dns");
      expect(dnsArgs).toContain("8.8.8.8");
      expect(dnsArgs).toContain("1.1.1.1");
    });

    it("includes extra hosts", () => {
      const args = buildSandboxCreateArgs({
        name: "c1",
        cfg: makeDockerConfig({ extraHosts: ["host1:1.2.3.4"] }),
        scopeKey: "test",
      });
      expect(args).toContain("--add-host");
      expect(args).toContain("host1:1.2.3.4");
    });

    it("includes pids limit", () => {
      const args = buildSandboxCreateArgs({
        name: "c1",
        cfg: makeDockerConfig({ pidsLimit: 50 }),
        scopeKey: "test",
      });
      expect(args).toContain("--pids-limit");
      expect(args).toContain("50");
    });

    it("omits pids limit when zero or undefined", () => {
      const args = buildSandboxCreateArgs({
        name: "c1",
        cfg: makeDockerConfig({ pidsLimit: 0 }),
        scopeKey: "test",
      });
      expect(args).not.toContain("--pids-limit");
    });

    it("includes memory limit", () => {
      const args = buildSandboxCreateArgs({
        name: "c1",
        cfg: makeDockerConfig({ memory: "256m" }),
        scopeKey: "test",
      });
      expect(args).toContain("--memory");
      expect(args).toContain("256m");
    });

    it("includes memory-swap limit", () => {
      const args = buildSandboxCreateArgs({
        name: "c1",
        cfg: makeDockerConfig({ memorySwap: "1g" }),
        scopeKey: "test",
      });
      expect(args).toContain("--memory-swap");
      expect(args).toContain("1g");
    });

    it("includes cpu limit", () => {
      const args = buildSandboxCreateArgs({
        name: "c1",
        cfg: makeDockerConfig({ cpus: 1.5 }),
        scopeKey: "test",
      });
      expect(args).toContain("--cpus");
      expect(args).toContain("1.5");
    });

    it("includes ulimits with simple value", () => {
      const args = buildSandboxCreateArgs({
        name: "c1",
        cfg: makeDockerConfig({ ulimits: { nofile: 1024 } }),
        scopeKey: "test",
      });
      expect(args).toContain("--ulimit");
      expect(args).toContain("nofile=1024");
    });

    it("includes ulimits with soft:hard value", () => {
      const args = buildSandboxCreateArgs({
        name: "c1",
        cfg: makeDockerConfig({
          ulimits: { nofile: { soft: 1024, hard: 2048 } },
        }),
        scopeKey: "test",
      });
      expect(args).toContain("nofile=1024:2048");
    });

    it("includes volume binds", () => {
      const args = buildSandboxCreateArgs({
        name: "c1",
        cfg: makeDockerConfig({
          binds: ["/host/path:/container/path:ro"],
        }),
        scopeKey: "test",
      });
      expect(args).toContain("-v");
      expect(args).toContain("/host/path:/container/path:ro");
    });

    it("includes custom labels", () => {
      const args = buildSandboxCreateArgs({
        name: "c1",
        cfg: makeDockerConfig(),
        scopeKey: "test",
        labels: { "com.example.env": "prod" },
      });
      expect(args).toContain("com.example.env=prod");
    });

    it("uses provided createdAtMs in label", () => {
      const args = buildSandboxCreateArgs({
        name: "c1",
        cfg: makeDockerConfig(),
        scopeKey: "test",
        createdAtMs: 1234567890,
      });
      expect(args).toContain("wopr.createdAtMs=1234567890");
    });

    it("skips empty dns entries", () => {
      const args = buildSandboxCreateArgs({
        name: "c1",
        cfg: makeDockerConfig({ dns: ["8.8.8.8", "  ", "1.1.1.1"] }),
        scopeKey: "test",
      });
      const dnsArgs = args.filter((_, i) => args[i - 1] === "--dns");
      expect(dnsArgs).toEqual(["8.8.8.8", "1.1.1.1"]);
    });

    it("skips empty extra hosts entries", () => {
      const args = buildSandboxCreateArgs({
        name: "c1",
        cfg: makeDockerConfig({ extraHosts: ["host:1.2.3.4", "  "] }),
        scopeKey: "test",
      });
      const hostArgs = args.filter((_, i) => args[i - 1] === "--add-host");
      expect(hostArgs).toEqual(["host:1.2.3.4"]);
    });
  });

  describe("execInContainerRaw", () => {
    it("throws on empty argv", async () => {
      await expect(execInContainerRaw("test-container", [])).rejects.toThrow(
        "at least one element",
      );
    });

    it("throws on invalid env key with equals sign", async () => {
      await expect(
        execInContainerRaw("test-container", ["ls"], { env: { "KEY=evil": "value" } }),
      ).rejects.toThrow("Invalid environment variable key");
    });

    it("throws on invalid env key with semicolon", async () => {
      await expect(
        execInContainerRaw("test-container", ["ls"], { env: { "KEY;rm -rf /": "value" } }),
      ).rejects.toThrow("Invalid environment variable key");
    });

    it("throws on env key starting with digit", async () => {
      await expect(
        execInContainerRaw("test-container", ["ls"], { env: { "1BAD": "value" } }),
      ).rejects.toThrow("Invalid environment variable key");
    });
  });
});
