import { vi, describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";

vi.mock("../src/skills.js", () => ({
  clearSkillCache: vi.fn(),
  createSkill: vi.fn(),
  discoverSkills: vi.fn(() => ({ skills: [], warnings: [] })),
  disableSkillAsync: vi.fn(),
  enableSkillAsync: vi.fn(),
  installSkillFromGitHub: vi.fn(),
  installSkillFromUrl: vi.fn(),
  readAllSkillStatesAsync: vi.fn(() => ({})),
  removeSkill: vi.fn(),
}));

vi.mock("../src/registries-repository.js", () => ({
  addRegistry: vi.fn(),
  listRegistries: vi.fn(),
  removeRegistry: vi.fn(),
}));

vi.mock("../src/registry-fetcher.js", () => ({
  fetchAllRegistries: vi.fn(),
}));

import { createSkillsRouter } from "../src/routes.js";
import { addRegistry, listRegistries, removeRegistry } from "../src/registries-repository.js";
import { fetchAllRegistries } from "../src/registry-fetcher.js";

describe("routes - registries", () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();
    const router = createSkillsRouter();
    app = new Hono();
    app.route("/skills", router);
  });

  describe("GET /skills/registries", () => {
    it("returns list of registries", async () => {
      vi.mocked(listRegistries).mockResolvedValue([
        { id: "test-reg", url: "https://example.com/r.json", addedAt: "2026-01-01T00:00:00Z" },
      ]);
      const res = await app.request("/skills/registries");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.registries).toHaveLength(1);
      expect(body.registries[0].name).toBe("test-reg");
    });

    it("returns empty array when no registries", async () => {
      vi.mocked(listRegistries).mockResolvedValue([]);
      const res = await app.request("/skills/registries");
      const body = await res.json();
      expect(body.registries).toEqual([]);
    });
  });

  describe("POST /skills/registries", () => {
    it("adds a registry", async () => {
      vi.mocked(addRegistry).mockResolvedValue({
        id: "new-reg",
        url: "https://example.com/r.json",
        addedAt: "2026-01-01T00:00:00Z",
      });
      const res = await app.request("/skills/registries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "new-reg", url: "https://example.com/r.json" }),
      });
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.added).toBe(true);
    });

    it("returns 400 when name missing", async () => {
      const res = await app.request("/skills/registries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: "https://example.com/r.json" }),
      });
      expect(res.status).toBe(400);
    });

    it("returns 400 when url missing", async () => {
      const res = await app.request("/skills/registries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "test" }),
      });
      expect(res.status).toBe(400);
    });

    it("returns 409 when registry already exists", async () => {
      vi.mocked(addRegistry).mockRejectedValue(new Error('Registry "dup" already exists'));
      const res = await app.request("/skills/registries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "dup", url: "https://example.com" }),
      });
      expect(res.status).toBe(409);
    });
  });

  describe("DELETE /skills/registries/:name", () => {
    it("removes a registry", async () => {
      vi.mocked(removeRegistry).mockResolvedValue(true);
      const res = await app.request("/skills/registries/my-reg", { method: "DELETE" });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.removed).toBe(true);
    });

    it("returns 404 when registry not found", async () => {
      vi.mocked(removeRegistry).mockResolvedValue(false);
      const res = await app.request("/skills/registries/nonexistent", { method: "DELETE" });
      expect(res.status).toBe(404);
    });
  });

  describe("GET /skills/available", () => {
    it("returns skills from all registries", async () => {
      vi.mocked(listRegistries).mockResolvedValue([
        { id: "reg1", url: "https://example.com/r.json", addedAt: "2026-01-01T00:00:00Z" },
      ]);
      vi.mocked(fetchAllRegistries).mockResolvedValue({
        skills: [{ name: "skill-a", description: "A", source: "github:a", registry: "reg1" }],
        errors: [],
      });
      const res = await app.request("/skills/available");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.skills).toHaveLength(1);
      expect(body.skills[0].name).toBe("skill-a");
    });

    it("returns empty when no registries configured", async () => {
      vi.mocked(listRegistries).mockResolvedValue([]);
      vi.mocked(fetchAllRegistries).mockResolvedValue({ skills: [], errors: [] });
      const res = await app.request("/skills/available");
      const body = await res.json();
      expect(body.skills).toEqual([]);
    });

    it("includes errors from failed registries", async () => {
      vi.mocked(listRegistries).mockResolvedValue([
        { id: "bad", url: "https://bad.com", addedAt: "2026-01-01T00:00:00Z" },
      ]);
      vi.mocked(fetchAllRegistries).mockResolvedValue({
        skills: [],
        errors: [{ registry: "bad", error: "ECONNREFUSED" }],
      });
      const res = await app.request("/skills/available");
      const body = await res.json();
      expect(body.errors).toHaveLength(1);
      expect(body.errors[0].registry).toBe("bad");
    });
  });

  describe("GET /skills/search", () => {
    it("returns 400 without query parameter", async () => {
      const res = await app.request("/skills/search");
      expect(res.status).toBe(400);
    });

    it("filters skills by query (case-insensitive name/description match)", async () => {
      vi.mocked(listRegistries).mockResolvedValue([
        { id: "reg1", url: "https://example.com/r.json", addedAt: "2026-01-01T00:00:00Z" },
      ]);
      vi.mocked(fetchAllRegistries).mockResolvedValue({
        skills: [
          { name: "git-helper", description: "Git utilities", source: "github:a", registry: "reg1" },
          { name: "docker-deploy", description: "Docker deployment", source: "github:b", registry: "reg1" },
        ],
        errors: [],
      });
      const res = await app.request("/skills/search?q=git");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.results).toHaveLength(1);
      expect(body.results[0].name).toBe("git-helper");
      expect(body.query).toBe("git");
    });

    it("matches on description too", async () => {
      vi.mocked(listRegistries).mockResolvedValue([
        { id: "reg1", url: "https://example.com/r.json", addedAt: "2026-01-01T00:00:00Z" },
      ]);
      vi.mocked(fetchAllRegistries).mockResolvedValue({
        skills: [
          { name: "deploy-tool", description: "Docker deployment helper", source: "github:a", registry: "reg1" },
        ],
        errors: [],
      });
      const res = await app.request("/skills/search?q=docker");
      const body = await res.json();
      expect(body.results).toHaveLength(1);
    });
  });
});
