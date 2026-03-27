import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WOPRPluginContext } from "@wopr-network/plugin-types";

vi.mock("../src/cron-client.js", async () => {
  const isRunning = vi.fn().mockResolvedValue(true);
  const getCrons = vi.fn().mockResolvedValue([]);
  const addCron = vi.fn().mockResolvedValue(undefined);
  const removeCron = vi.fn().mockResolvedValue(undefined);
  const inject = vi.fn().mockResolvedValue(undefined);

  class MockCronClient {
    isRunning = isRunning;
    getCrons = getCrons;
    addCron = addCron;
    removeCron = removeCron;
    inject = inject;
  }

  return {
    CronClient: MockCronClient,
    getDaemonUrl: vi.fn(() => "http://localhost:4040"),
    __mocks: { isRunning, getCrons, addCron, removeCron, inject },
  };
});

// Import after mock registration
const cronClientModule = await import("../src/cron-client.js");
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mocks = (cronClientModule as any).__mocks as {
  isRunning: ReturnType<typeof vi.fn>;
  getCrons: ReturnType<typeof vi.fn>;
  addCron: ReturnType<typeof vi.fn>;
  removeCron: ReturnType<typeof vi.fn>;
  inject: ReturnType<typeof vi.fn>;
};

const { cronCommandHandler } = await import("../src/cron-commands.js");

const mockCtx = {} as WOPRPluginContext;

describe("cronCommandHandler", () => {
  beforeEach(() => {
    mocks.isRunning.mockResolvedValue(true);
    mocks.getCrons.mockResolvedValue([]);
    mocks.addCron.mockResolvedValue(undefined);
    mocks.removeCron.mockResolvedValue(undefined);
    mocks.inject.mockResolvedValue(undefined);
  });

  it("should handle 'list' with no crons", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await cronCommandHandler(mockCtx, ["list"]);
    expect(logSpy).toHaveBeenCalledWith("No crons.");
    logSpy.mockRestore();
  });

  it("should handle 'list' with crons", async () => {
    mocks.getCrons.mockResolvedValue([
      { name: "myjob", schedule: "* * * * *", session: "sess1", message: "hello" },
    ]);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await cronCommandHandler(mockCtx, ["list"]);
    expect(logSpy).toHaveBeenCalledWith("Crons:");
    logSpy.mockRestore();
  });

  it("should handle 'add' with correct args", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await cronCommandHandler(mockCtx, ["add", "myjob", "* * * * *", "sess1", "hello", "world"]);
    expect(mocks.addCron).toHaveBeenCalledWith(
      expect.objectContaining({ name: "myjob", schedule: "* * * * *", session: "sess1", message: "hello world" }),
    );
    expect(logSpy).toHaveBeenCalledWith("Added cron: myjob");
    logSpy.mockRestore();
  });

  it("should error on 'add' with insufficient args", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("exit");
    }) as never);

    await expect(cronCommandHandler(mockCtx, ["add", "myjob"])).rejects.toThrow("exit");
    expect(errSpy).toHaveBeenCalled();

    errSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it("should handle 'remove' subcommand", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await cronCommandHandler(mockCtx, ["remove", "myjob"]);
    expect(mocks.removeCron).toHaveBeenCalledWith("myjob");
    expect(logSpy).toHaveBeenCalledWith("Removed: myjob");
    logSpy.mockRestore();
  });

  it("should error on 'remove' without name", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("exit");
    }) as never);

    await expect(cronCommandHandler(mockCtx, ["remove"])).rejects.toThrow("exit");
    errSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it("should handle 'once' subcommand", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await cronCommandHandler(mockCtx, ["once", "+5m", "sess1", "run this"]);
    expect(mocks.addCron).toHaveBeenCalledWith(
      expect.objectContaining({ schedule: "once", session: "sess1", message: "run this", once: true }),
    );
    logSpy.mockRestore();
  });

  it("should handle 'now' subcommand", async () => {
    await cronCommandHandler(mockCtx, ["now", "sess1", "hello world"]);
    expect(mocks.inject).toHaveBeenCalledWith("sess1", "hello world", expect.any(Function));
  });

  it("should print help for unknown subcommand", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await cronCommandHandler(mockCtx, ["unknown"]);
    expect(logSpy).toHaveBeenCalled();
    logSpy.mockRestore();
  });

  it("should exit when daemon not running", async () => {
    mocks.isRunning.mockResolvedValue(false);
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("exit");
    }) as never);

    await expect(cronCommandHandler(mockCtx, ["list"])).rejects.toThrow("exit");
    expect(errSpy).toHaveBeenCalledWith("Daemon not running. Start it: wopr daemon start");

    errSpy.mockRestore();
    exitSpy.mockRestore();
  });
});
