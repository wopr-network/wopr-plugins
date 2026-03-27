import { describe, it, expect, beforeEach } from "vitest";
import { setRuntime, getLogger, getStorage, getMainConfig } from "../src/runtime.js";

describe("runtime", () => {
  describe("before setRuntime", () => {
    // Note: Since runtime is a module singleton and setRuntime may have been called
    // by other tests, we test the error paths by using a fresh approach

    it("getLogger returns a logger (noop by default)", () => {
      // getLogger always returns something (noopLogger or injected)
      const logger = getLogger();
      expect(logger).toBeDefined();
      expect(typeof logger.info).toBe("function");
      expect(typeof logger.warn).toBe("function");
      expect(typeof logger.error).toBe("function");
      expect(typeof logger.debug).toBe("function");
    });
  });

  describe("after setRuntime", () => {
    const mockLogger = {
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {},
    };
    const mockStorage = {
      register: async () => {},
      getRepository: () => ({}),
    } as any;
    const mockConfig = () => ({ sandbox: { mode: "all" } });

    beforeEach(() => {
      setRuntime({
        logger: mockLogger,
        storage: mockStorage,
        getMainConfig: mockConfig,
      });
    });

    it("getLogger returns injected logger", () => {
      expect(getLogger()).toBe(mockLogger);
    });

    it("getStorage returns injected storage", () => {
      expect(getStorage()).toBe(mockStorage);
    });

    it("getMainConfig returns result of injected function", () => {
      const cfg = getMainConfig();
      expect(cfg).toEqual({ sandbox: { mode: "all" } });
    });
  });
});
