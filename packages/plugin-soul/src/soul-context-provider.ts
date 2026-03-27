/**
 * Soul context provider — injects SOUL.md content into conversation context.
 *
 * Priority 8: loaded early so the AI sees persona/boundaries before other context.
 *
 * Resolution order:
 *   1. Global soul: getContext("__global__", "SOUL.md")
 *   2. Session soul: getContext(session, "SOUL.md")
 */

import type { ContextPart, ContextProvider, MessageInfo, WOPRPluginContext } from "@wopr-network/plugin-types";

type SessionApi = {
  getContext(sessionName: string, filename: string): Promise<string | null>;
};

export function buildSoulContextProvider(ctx: WOPRPluginContext): ContextProvider {
  return {
    name: "soul",
    priority: 8,
    enabled: true,

    async getContext(session: string, _message: MessageInfo): Promise<ContextPart | null> {
      const sessionApi = (ctx as unknown as { session?: SessionApi }).session;

      if (!sessionApi) {
        return null;
      }

      try {
        // Try global identity first
        const globalContent = await sessionApi.getContext("__global__", "SOUL.md");
        if (globalContent?.trim()) {
          return {
            content: `## Soul (Global)\n\n${globalContent}`,
            role: "system",
            metadata: {
              source: "soul",
              priority: 8,
              location: "global",
            },
          };
        }

        // Fall back to session
        const sessionContent = await sessionApi.getContext(session, "SOUL.md");
        if (sessionContent?.trim()) {
          return {
            content: `## Soul\n\n${sessionContent}`,
            role: "system",
            metadata: {
              source: "soul",
              priority: 8,
              location: "session",
            },
          };
        }
      } catch (_error: unknown) {
        return null;
      }

      return null;
    },
  };
}
