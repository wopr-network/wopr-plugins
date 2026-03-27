import { beforeEach, describe, expect, it, vi } from "vitest";
import { CronClient } from "../src/cron-client.js";

describe("CronClient", () => {
  let client: CronClient;

  beforeEach(() => {
    client = new CronClient("http://localhost:4040");
    vi.restoreAllMocks();
  });

  it("should construct with base URL", () => {
    expect(client).toBeDefined();
  });

  it("getCrons calls GET /crons", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ crons: [{ name: "test", schedule: "* * * * *", session: "s1", message: "hello" }] }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const crons = await client.getCrons();
    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:4040/crons",
      expect.objectContaining({ headers: expect.objectContaining({ "Content-Type": "application/json" }) }),
    );
    expect(crons).toHaveLength(1);
    expect(crons[0].name).toBe("test");

    vi.unstubAllGlobals();
  });

  it("addCron calls POST /crons", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
    vi.stubGlobal("fetch", mockFetch);

    await client.addCron({ name: "test", schedule: "* * * * *", session: "s1", message: "hello" });
    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:4040/crons",
      expect.objectContaining({ method: "POST" }),
    );

    vi.unstubAllGlobals();
  });

  it("removeCron calls DELETE /crons/:name", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
    vi.stubGlobal("fetch", mockFetch);

    await client.removeCron("test");
    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:4040/crons/test",
      expect.objectContaining({ method: "DELETE" }),
    );

    vi.unstubAllGlobals();
  });

  it("isRunning returns true when daemon responds", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ status: "ok" }) });
    vi.stubGlobal("fetch", mockFetch);

    const running = await client.isRunning();
    expect(running).toBe(true);

    vi.unstubAllGlobals();
  });

  it("isRunning returns false when fetch throws", async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    vi.stubGlobal("fetch", mockFetch);

    const running = await client.isRunning();
    expect(running).toBe(false);

    vi.unstubAllGlobals();
  });

  it("throws on non-ok response", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      text: () => Promise.resolve("Not Found"),
    });
    vi.stubGlobal("fetch", mockFetch);

    await expect(client.getCrons()).rejects.toThrow("HTTP 404");

    vi.unstubAllGlobals();
  });
});
