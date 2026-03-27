/**
 * Soul A2A tools: soul.get, soul.update
 *
 * Provides agent-to-agent tools for reading and updating SOUL.md,
 * the persistent persona/boundaries/interaction-style file.
 *
 * Resolution order for reads:
 *   1. Session: getContext(sessionName, "SOUL.md")
 *   2. Global: getContext("__global__", "SOUL.md")
 *
 * Writes always go to session scope.
 */

import type { A2AServerConfig, WOPRPluginContext } from "@wopr-network/plugin-types";

type SessionApi = {
  getContext(sessionName: string, filename: string): Promise<string | null>;
  setContext(sessionName: string, filename: string, content: string, source: "global" | "session"): Promise<void>;
};

export function buildSoulA2ATools(ctx: WOPRPluginContext, sessionName: string): A2AServerConfig {
  const sessionApi = (ctx as unknown as { session?: SessionApi }).session;

  return {
    name: "soul",
    version: "1.0.0",
    tools: [
      {
        name: "soul.get",
        description:
          "Get current SOUL.md content (persona, boundaries, interaction style). Checks session first, falls back to global.",
        inputSchema: { type: "object", additionalProperties: false },
        async handler() {
          if (!sessionApi) {
            return { content: [{ type: "text", text: "No SOUL.md found." }] };
          }

          try {
            // Try session first, then global
            const sessionContent = await sessionApi.getContext(sessionName, "SOUL.md");
            if (sessionContent) {
              return {
                content: [{ type: "text", text: `[Source: session]\n\n${sessionContent}` }],
              };
            }

            const globalContent = await sessionApi.getContext("__global__", "SOUL.md");
            if (globalContent) {
              return {
                content: [{ type: "text", text: `[Source: global]\n\n${globalContent}` }],
              };
            }
          } catch (_error: unknown) {
            return { content: [{ type: "text", text: "No SOUL.md found." }] };
          }

          return { content: [{ type: "text", text: "No SOUL.md found." }] };
        },
      },
      {
        name: "soul.update",
        description: "Update SOUL.md content.",
        inputSchema: {
          type: "object",
          properties: {
            content: {
              type: "string",
              description: "Full content to replace SOUL.md",
            },
            section: {
              type: "string",
              description: "Section header to add/update",
            },
            sectionContent: {
              type: "string",
              description: "Content for the section",
            },
          },
        },
        async handler(args: unknown) {
          const { content, section, sectionContent } = args as {
            content?: string;
            section?: string;
            sectionContent?: string;
          };

          if (!sessionApi) {
            return { content: [{ type: "text", text: "Provide 'content' or 'section'+'sectionContent'" }] };
          }

          if (content !== undefined) {
            try {
              await sessionApi.setContext(sessionName, "SOUL.md", content, "session");
            } catch (error: unknown) {
              return {
                content: [
                  {
                    type: "text",
                    text: `Failed to update SOUL.md: ${error instanceof Error ? error.message : String(error)}`,
                  },
                ],
              };
            }
            return { content: [{ type: "text", text: "SOUL.md replaced entirely" }] };
          }

          if (section !== undefined && sectionContent !== undefined) {
            try {
              let existing = await sessionApi.getContext(sessionName, "SOUL.md");
              if (!existing) {
                existing = "# SOUL.md - Persona & Boundaries\n\n";
              }
              const safeSection = section.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
              const sectionRegex = new RegExp(`## ${safeSection}[\\s\\S]*?(?=\\n## |$)`, "i");
              const newSection = `## ${section}\n\n${sectionContent}\n`;
              if (existing.match(sectionRegex)) {
                existing = existing.replace(sectionRegex, newSection);
              } else {
                existing += `\n${newSection}`;
              }
              await sessionApi.setContext(sessionName, "SOUL.md", existing, "session");
            } catch (error: unknown) {
              return {
                content: [
                  {
                    type: "text",
                    text: `Failed to update SOUL.md: ${error instanceof Error ? error.message : String(error)}`,
                  },
                ],
              };
            }
            return { content: [{ type: "text", text: `SOUL.md section "${section}" updated` }] };
          }

          return {
            content: [{ type: "text", text: "Provide 'content' or 'section'+'sectionContent'" }],
          };
        },
      },
    ],
  };
}
