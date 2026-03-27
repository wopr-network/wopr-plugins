import { describe, expect, it, vi } from "vitest";
import { buildA2ATools } from "../src/a2a-tools.js";
import type { MemoryEntry } from "../src/memory-obsidian-schema.js";
import type { MemoryObsidianExtension } from "../src/types.js";

function makeEntry(overrides: Partial<MemoryEntry> = {}): MemoryEntry {
  return {
    id: "id-001",
    sessionId: "sess-001",
    vaultPath: "WOPR/memories/2024-01/sess-id.md",
    content: "User prefers TypeScript",
    summary: "User prefers TypeScript",
    tags: '["auto","triggered"]',
    createdAt: 1_700_000_000_000,
    ...overrides,
  };
}

function makeExt(overrides: Partial<MemoryObsidianExtension> = {}): MemoryObsidianExtension {
  return {
    store: vi.fn().mockResolvedValue(makeEntry()),
    search: vi.fn().mockResolvedValue([makeEntry()]),
    recall: vi.fn().mockResolvedValue([makeEntry()]),
    forget: vi.fn().mockResolvedValue(true),
    list: vi.fn().mockResolvedValue([makeEntry()]),
    ...overrides,
  };
}

describe("memory.store", () => {
  it("calls ext.store and returns id + vaultPath", async () => {
    const ext = makeExt();
    const tools = buildA2ATools(ext);
    const tool = tools.find((t) => t.name === "memory.store")!;
    const result = await tool.handler({ sessionId: "s1", content: "test", tags: ["tag1"] });
    expect(result.isError).toBeFalsy();
    expect(ext.store).toHaveBeenCalledWith("s1", "test", ["tag1"]);
    const data = JSON.parse(result.content[0].text);
    expect(data.id).toBe("id-001");
  });

  it("returns error on failure", async () => {
    const ext = makeExt({ store: vi.fn().mockRejectedValue(new Error("vault down")) });
    const tools = buildA2ATools(ext);
    const tool = tools.find((t) => t.name === "memory.store")!;
    const result = await tool.handler({ sessionId: "s1", content: "x" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("vault down");
  });
});

describe("memory.search", () => {
  it("returns formatted entries", async () => {
    const ext = makeExt();
    const tools = buildA2ATools(ext);
    const tool = tools.find((t) => t.name === "memory.search")!;
    const result = await tool.handler({ query: "TypeScript", limit: 5 });
    expect(result.isError).toBeFalsy();
    const data = JSON.parse(result.content[0].text);
    expect(data).toHaveLength(1);
    expect(data[0].id).toBe("id-001");
    expect(data[0].tags).toEqual(["auto", "triggered"]);
  });
});

describe("memory.recall", () => {
  it("calls ext.recall with session and query", async () => {
    const ext = makeExt();
    const tools = buildA2ATools(ext);
    const tool = tools.find((t) => t.name === "memory.recall")!;
    await tool.handler({ sessionId: "s1", query: "TypeScript", limit: 3 });
    expect(ext.recall).toHaveBeenCalledWith("s1", "TypeScript", 3);
  });
});

describe("memory.forget", () => {
  it("calls ext.forget and returns deleted status", async () => {
    const ext = makeExt();
    const tools = buildA2ATools(ext);
    const tool = tools.find((t) => t.name === "memory.forget")!;
    const result = await tool.handler({ id: "id-001" });
    expect(result.isError).toBeFalsy();
    const data = JSON.parse(result.content[0].text);
    expect(data.deleted).toBe(true);
    expect(data.id).toBe("id-001");
  });
});

describe("memory.list", () => {
  it("lists all memories when no session given", async () => {
    const ext = makeExt();
    const tools = buildA2ATools(ext);
    const tool = tools.find((t) => t.name === "memory.list")!;
    const result = await tool.handler({});
    expect(result.isError).toBeFalsy();
    const data = JSON.parse(result.content[0].text);
    expect(data).toHaveLength(1);
    expect(ext.list).toHaveBeenCalledWith(undefined);
  });

  it("passes sessionId when provided", async () => {
    const ext = makeExt();
    const tools = buildA2ATools(ext);
    const tool = tools.find((t) => t.name === "memory.list")!;
    await tool.handler({ sessionId: "s1" });
    expect(ext.list).toHaveBeenCalledWith("s1");
  });
});
