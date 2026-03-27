import type { ConfigSchema } from "@wopr-network/plugin-types";
import type { SetupSession } from "./types.js";

const sessions = new Map<string, SetupSession>();

export function createSession(sessionId: string, pluginId: string, configSchema: ConfigSchema): SetupSession {
  const session: SetupSession = {
    sessionId,
    pluginId,
    configSchema,
    mutations: [],
    collectedValues: new Map(),
    completed: false,
    createdAt: Date.now(),
  };
  sessions.set(sessionId, session);
  return session;
}

export function getSession(sessionId: string): SetupSession | undefined {
  return sessions.get(sessionId);
}

export function deleteSession(sessionId: string): boolean {
  return sessions.delete(sessionId);
}

export function isSetupActive(sessionId: string): boolean {
  const s = sessions.get(sessionId);
  return s !== undefined && !s.completed;
}

export function clearAllSessions(): void {
  sessions.clear();
}
