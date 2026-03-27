import { readFileSync } from "node:fs";

export interface CronJob {
  name: string;
  schedule: string;
  session: string;
  message: string;
  scripts?: CronScript[];
  once?: boolean;
  runAt?: number;
}

export interface CronScript {
  name: string;
  command: string;
  timeout?: number;
  cwd?: string;
}

export type StreamCallback = (msg: { type: string; content: string }) => void;

/** Read daemon port from ~/.wopr/config.json or default to 4040 */
export function getDaemonUrl(): string {
  try {
    const homedir = process.env.HOME ?? process.env.USERPROFILE ?? ".";
    const raw = readFileSync(`${homedir}/.wopr/config.json`, "utf-8");
    const config = JSON.parse(raw);
    const port = config?.daemon?.port ?? 4040;
    return `http://localhost:${port}`;
  } catch {
    return "http://localhost:4040";
  }
}

export class CronClient {
  constructor(private baseUrl: string) {}

  private async request<T = unknown>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...init?.headers },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status}: ${text}`);
    }
    return res.json() as Promise<T>;
  }

  async isRunning(): Promise<boolean> {
    try {
      await this.request("/status");
      return true;
    } catch {
      return false;
    }
  }

  async getCrons(): Promise<CronJob[]> {
    const data = await this.request<{ crons: CronJob[] }>("/crons");
    return data.crons;
  }

  async addCron(cron: Omit<CronJob, "runAt"> & { runAt?: number }): Promise<void> {
    await this.request("/crons", { method: "POST", body: JSON.stringify(cron) });
  }

  async removeCron(name: string): Promise<void> {
    await this.request(`/crons/${encodeURIComponent(name)}`, { method: "DELETE" });
  }

  async inject(session: string, message: string, onStream?: StreamCallback): Promise<void> {
    if (onStream) {
      const res = await fetch(`${this.baseUrl}/sessions/${encodeURIComponent(session)}/inject`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
        body: JSON.stringify({ message, stream: true }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (!res.body) return;
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const msg = JSON.parse(line.slice(6));
              onStream(msg);
            } catch {
              /* skip malformed */
            }
          }
        }
      }
    } else {
      await this.request(`/sessions/${encodeURIComponent(session)}/inject`, {
        method: "POST",
        body: JSON.stringify({ message }),
      });
    }
  }
}
