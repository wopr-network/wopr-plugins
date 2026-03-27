import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  resolveSandboxScope,
  resolveSandboxDockerConfig,
  resolveSandboxPruneConfig,
} from "../src/config.js";
import {
  DEFAULT_SANDBOX_IMAGE,
  DEFAULT_SANDBOX_CONTAINER_PREFIX,
  DEFAULT_SANDBOX_WORKDIR,
  DEFAULT_SANDBOX_IDLE_HOURS,
  DEFAULT_SANDBOX_MAX_AGE_DAYS,
} from "../src/constants.js";

describe("config", () => {
  describe("resolveSandboxScope", () => {
    it("returns explicit scope when provided", () => {
      expect(resolveSandboxScope({ scope: "shared" })).toBe("shared");
      expect(resolveSandboxScope({ scope: "session" })).toBe("session");
    });

    it("uses perSession boolean when scope is not provided", () => {
      expect(resolveSandboxScope({ perSession: true })).toBe("session");
      expect(resolveSandboxScope({ perSession: false })).toBe("shared");
    });

    it("defaults to session when neither is provided", () => {
      expect(resolveSandboxScope({})).toBe("session");
    });

    it("explicit scope takes priority over perSession", () => {
      expect(resolveSandboxScope({ scope: "shared", perSession: true })).toBe(
        "shared"
      );
    });
  });

  describe("resolveSandboxDockerConfig", () => {
    it("returns all defaults when no config provided", () => {
      const result = resolveSandboxDockerConfig({});
      expect(result.image).toBe(DEFAULT_SANDBOX_IMAGE);
      expect(result.containerPrefix).toBe(DEFAULT_SANDBOX_CONTAINER_PREFIX);
      expect(result.workdir).toBe(DEFAULT_SANDBOX_WORKDIR);
      expect(result.readOnlyRoot).toBe(true);
      expect(result.tmpfs).toEqual(["/tmp", "/var/tmp", "/run"]);
      expect(result.network).toBe("none");
      expect(result.capDrop).toEqual(["ALL"]);
      expect(result.env).toEqual({ LANG: "C.UTF-8" });
      expect(result.pidsLimit).toBe(100);
      expect(result.memory).toBe("512m");
      expect(result.memorySwap).toBe("512m");
      expect(result.cpus).toBe(0.5);
    });

    it("uses global config values", () => {
      const result = resolveSandboxDockerConfig({
        globalDocker: {
          image: "custom:latest",
          containerPrefix: "my-",
          workdir: "/app",
          readOnlyRoot: false,
          tmpfs: ["/tmp"],
          network: "bridge",
          capDrop: ["NET_RAW"],
          pidsLimit: 200,
          memory: "1g",
          memorySwap: "2g",
          cpus: 2,
        },
      });
      expect(result.image).toBe("custom:latest");
      expect(result.containerPrefix).toBe("my-");
      expect(result.workdir).toBe("/app");
      expect(result.readOnlyRoot).toBe(false);
      expect(result.network).toBe("bridge");
      expect(result.pidsLimit).toBe(200);
      expect(result.memory).toBe("1g");
      expect(result.cpus).toBe(2);
    });

    it("session overrides global", () => {
      const result = resolveSandboxDockerConfig({
        globalDocker: {
          image: "global:v1",
          containerPrefix: "g-",
          workdir: "/global",
          readOnlyRoot: true,
          tmpfs: ["/tmp"],
          network: "none",
          capDrop: ["ALL"],
        },
        sessionDocker: {
          image: "session:v2",
          containerPrefix: "s-",
          workdir: "/session",
          readOnlyRoot: false,
          tmpfs: ["/tmp", "/var/tmp"],
          network: "host",
          capDrop: ["NET_RAW"],
        },
      });
      expect(result.image).toBe("session:v2");
      expect(result.containerPrefix).toBe("s-");
      expect(result.workdir).toBe("/session");
      expect(result.readOnlyRoot).toBe(false);
      expect(result.network).toBe("host");
    });

    it("merges env from global and session", () => {
      const result = resolveSandboxDockerConfig({
        globalDocker: {
          image: "i",
          containerPrefix: "p",
          workdir: "/w",
          readOnlyRoot: true,
          tmpfs: [],
          network: "none",
          capDrop: [],
          env: { LANG: "en_US.UTF-8", FOO: "bar" },
        },
        sessionDocker: {
          image: "i",
          containerPrefix: "p",
          workdir: "/w",
          readOnlyRoot: true,
          tmpfs: [],
          network: "none",
          capDrop: [],
          env: { FOO: "baz", EXTRA: "val" },
        },
      });
      expect(result.env).toEqual({
        LANG: "en_US.UTF-8",
        FOO: "baz",
        EXTRA: "val",
      });
    });

    it("merges binds from global and session", () => {
      const result = resolveSandboxDockerConfig({
        globalDocker: {
          image: "i",
          containerPrefix: "p",
          workdir: "/w",
          readOnlyRoot: true,
          tmpfs: [],
          network: "none",
          capDrop: [],
          binds: ["/host/a:/container/a"],
        },
        sessionDocker: {
          image: "i",
          containerPrefix: "p",
          workdir: "/w",
          readOnlyRoot: true,
          tmpfs: [],
          network: "none",
          capDrop: [],
          binds: ["/host/b:/container/b"],
        },
      });
      expect(result.binds).toEqual([
        "/host/a:/container/a",
        "/host/b:/container/b",
      ]);
    });

    it("returns undefined binds when both are empty", () => {
      const result = resolveSandboxDockerConfig({});
      expect(result.binds).toBeUndefined();
    });

    it("merges ulimits from global and session", () => {
      const result = resolveSandboxDockerConfig({
        globalDocker: {
          image: "i",
          containerPrefix: "p",
          workdir: "/w",
          readOnlyRoot: true,
          tmpfs: [],
          network: "none",
          capDrop: [],
          ulimits: { nofile: 1024 },
        },
        sessionDocker: {
          image: "i",
          containerPrefix: "p",
          workdir: "/w",
          readOnlyRoot: true,
          tmpfs: [],
          network: "none",
          capDrop: [],
          ulimits: { nproc: 512 },
        },
      });
      expect(result.ulimits).toEqual({ nofile: 1024, nproc: 512 });
    });
  });

  describe("resolveSandboxPruneConfig", () => {
    it("returns defaults when no config provided", () => {
      const result = resolveSandboxPruneConfig({});
      expect(result.idleHours).toBe(DEFAULT_SANDBOX_IDLE_HOURS);
      expect(result.maxAgeDays).toBe(DEFAULT_SANDBOX_MAX_AGE_DAYS);
    });

    it("uses global config", () => {
      const result = resolveSandboxPruneConfig({
        globalPrune: { idleHours: 48, maxAgeDays: 14 },
      });
      expect(result.idleHours).toBe(48);
      expect(result.maxAgeDays).toBe(14);
    });

    it("session overrides global", () => {
      const result = resolveSandboxPruneConfig({
        globalPrune: { idleHours: 48, maxAgeDays: 14 },
        sessionPrune: { idleHours: 12, maxAgeDays: 3 },
      });
      expect(result.idleHours).toBe(12);
      expect(result.maxAgeDays).toBe(3);
    });

    it("partially overrides global values", () => {
      const result = resolveSandboxPruneConfig({
        globalPrune: { idleHours: 48, maxAgeDays: 14 },
        sessionPrune: { idleHours: 12 },
      });
      expect(result.idleHours).toBe(12);
      expect(result.maxAgeDays).toBe(14);
    });
  });
});
