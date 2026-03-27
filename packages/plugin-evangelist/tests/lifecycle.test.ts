import { describe, it, expect } from "vitest";
import plugin from "../src/index.js";
import { createMockContext } from "./mocks/wopr-context.js";

describe("plugin lifecycle", () => {
  it("init registers config schema and setup context provider", async () => {
    const ctx = createMockContext({ productOneLiner: "AI bots", audience: "developers", voice: "punchy" });
    await plugin.init!(ctx);

    expect(ctx.registerConfigSchema).toHaveBeenCalledWith("wopr-plugin-evangelist", expect.any(Object));
    expect(ctx.registerSetupContextProvider).toHaveBeenCalled();
    expect(ctx.registerContextProvider).toHaveBeenCalledWith(
      expect.objectContaining({ name: "evangelist-brand-voice" }),
    );

    await plugin.shutdown!();
  });

  it("init without product config skips brand voice registration", async () => {
    const ctx = createMockContext({});
    await plugin.init!(ctx);

    expect(ctx.registerContextProvider).not.toHaveBeenCalled();

    await plugin.shutdown!();
  });

  it("shutdown unregisters everything", async () => {
    const ctx = createMockContext({ productOneLiner: "AI bots", audience: "developers", voice: "punchy" });
    await plugin.init!(ctx);
    await plugin.shutdown!();

    expect(ctx.unregisterContextProvider).toHaveBeenCalledWith("evangelist-brand-voice");
    expect(ctx.unregisterSetupContextProvider).toHaveBeenCalled();
    expect(ctx.unregisterConfigSchema).toHaveBeenCalledWith("wopr-plugin-evangelist");
  });
});
