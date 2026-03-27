/**
 * Skills API routes
 * REFACTORED for standalone plugin
 */

import { Hono } from "hono";
import { addRegistry, listRegistries, removeRegistry } from "./registries-repository.js";
import { fetchAllRegistries } from "./registry-fetcher.js";
import {
  clearSkillCache,
  createSkill,
  disableSkillAsync,
  discoverSkills,
  enableSkillAsync,
  installSkillFromGitHub,
  installSkillFromUrl,
  readAllSkillStatesAsync,
  removeSkill,
} from "./skills.js";

export function createSkillsRouter() {
  const skillsRouter = new Hono();

  // List installed skills
  skillsRouter.get("/", async (c) => {
    const { skills, warnings } = discoverSkills();
    const skillStates = await readAllSkillStatesAsync();
    return c.json({
      skills: skills.map((s) => ({
        name: s.name,
        description: s.description,
        source: s.source,
        enabled: skillStates[s.name]?.enabled !== false,
        category: s.metadata?.emoji ? "custom" : "general",
        version: null,
        metadata: s.metadata ?? null,
      })),
      warnings: warnings.length > 0 ? warnings : undefined,
    });
  });

  // Search registries for available skills
  skillsRouter.get("/available", async (c) => {
    const query = c.req.query("q") || "";
    try {
      const registries = await listRegistries();
      const { skills, errors } = await fetchAllRegistries(registries);
      const filtered = query
        ? skills.filter(
            (s) =>
              s.name.toLowerCase().includes(query.toLowerCase()) ||
              s.description.toLowerCase().includes(query.toLowerCase()),
          )
        : skills;
      return c.json({ skills: filtered, errors: errors.length > 0 ? errors : undefined });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message, skills: [] }, 500);
    }
  });

  // Create a new skill
  skillsRouter.post("/", async (c) => {
    const body = await c.req.json();
    const { name, description } = body;

    if (!name) {
      return c.json({ error: "name is required" }, 400);
    }

    try {
      const skill = createSkill(name, description);
      return c.json({ created: true, skill }, 201);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message }, 400);
    }
  });

  // Install skill from source
  skillsRouter.post("/install", async (c) => {
    const body = await c.req.json();
    const { source, name } = body;

    if (!source) {
      return c.json({ error: "source is required" }, 400);
    }

    try {
      let skill: ReturnType<typeof installSkillFromGitHub> | ReturnType<typeof installSkillFromUrl>;
      if (source.startsWith("github:")) {
        const parts = source.replace("github:", "").split("/");
        const [owner, repo, ...pathParts] = parts;
        const skillPath = pathParts.join("/");
        skill = installSkillFromGitHub(owner, repo, skillPath, name);
      } else {
        skill = installSkillFromUrl(source, name);
      }
      return c.json({ installed: true, skill }, 201);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message }, 400);
    }
  });

  // Uninstall skill (POST-based)
  skillsRouter.post("/uninstall", async (c) => {
    const body = await c.req.json();
    const { name } = body;

    if (!name) {
      return c.json({ error: "name is required" }, 400);
    }

    try {
      removeSkill(name);
      return c.json({ removed: true });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message }, 400);
    }
  });

  // Remove skill (DELETE-based, kept for backward compatibility)
  skillsRouter.delete("/:name", (c) => {
    const name = c.req.param("name");

    try {
      removeSkill(name);
      return c.json({ removed: true });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message }, 400);
    }
  });

  // Enable a skill
  skillsRouter.post("/:name/enable", async (c) => {
    const name = c.req.param("name");
    try {
      const found = await enableSkillAsync(name);

      if (!found) {
        return c.json({ error: "Skill not found" }, 404);
      }

      return c.json({ enabled: true });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message }, 500);
    }
  });

  // Disable a skill
  skillsRouter.post("/:name/disable", async (c) => {
    const name = c.req.param("name");
    try {
      const found = await disableSkillAsync(name);

      if (!found) {
        return c.json({ error: "Skill not found" }, 404);
      }

      return c.json({ disabled: true });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message }, 500);
    }
  });

  // Search registries for skills (with required query)
  skillsRouter.get("/search", async (c) => {
    const query = c.req.query("q");

    if (!query) {
      return c.json({ error: "Query parameter 'q' is required" }, 400);
    }

    try {
      const registries = await listRegistries();
      const { skills, errors } = await fetchAllRegistries(registries);
      const results = skills.filter(
        (s) =>
          s.name.toLowerCase().includes(query.toLowerCase()) ||
          s.description.toLowerCase().includes(query.toLowerCase()),
      );
      return c.json({ results, query, errors: errors.length > 0 ? errors : undefined });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message, results: [], query }, 500);
    }
  });

  // Clear skill cache
  skillsRouter.post("/cache/clear", (c) => {
    clearSkillCache();
    return c.json({ cleared: true });
  });

  // Skill registries
  skillsRouter.get("/registries", async (c) => {
    try {
      const registries = await listRegistries();
      return c.json({
        registries: registries.map((r) => ({
          name: r.id,
          url: r.url,
          addedAt: r.addedAt,
          lastFetchedAt: r.lastFetchedAt ?? null,
          lastError: r.lastError ?? null,
        })),
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message }, 500);
    }
  });

  skillsRouter.post("/registries", async (c) => {
    const body = await c.req.json();
    const { name, url } = body;

    if (!name || !url) {
      return c.json({ error: "name and url are required" }, 400);
    }

    try {
      const registry = await addRegistry(name, url);
      return c.json({ added: true, registry: { name: registry.id, url: registry.url } }, 201);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("already exists")) {
        return c.json({ error: message }, 409);
      }
      return c.json({ error: message }, 500);
    }
  });

  skillsRouter.delete("/registries/:name", async (c) => {
    const name = c.req.param("name");
    try {
      const removed = await removeRegistry(name);
      if (!removed) {
        return c.json({ error: `Registry "${name}" not found` }, 404);
      }
      return c.json({ removed: true });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message }, 500);
    }
  });

  return skillsRouter;
}
