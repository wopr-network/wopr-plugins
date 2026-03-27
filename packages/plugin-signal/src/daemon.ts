/**
 * Signal CLI Daemon Management
 */

import { spawn } from "node:child_process";
import { signalCheck } from "./client.js";

export interface SignalDaemonOptions {
  cliPath: string;
  account?: string;
  httpHost: string;
  httpPort: number;
  receiveMode?: "native" | "manually";
  ignoreAttachments?: boolean;
  ignoreStories?: boolean;
  sendReadReceipts?: boolean;
  runtime?: {
    log?: (msg: string) => void;
    error?: (msg: string) => void;
  };
}

export interface SignalDaemonHandle {
  pid?: number;
  stop: () => void;
}

function classifySignalCliLogLine(line: string): "log" | "error" | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  // signal-cli commonly writes all logs to stderr; treat severity explicitly.
  if (/\b(ERROR|WARN|WARNING)\b/.test(trimmed)) return "error";

  // Some signal-cli failures are not tagged with WARN/ERROR
  if (/\b(FAILED|SEVERE|EXCEPTION)\b/i.test(trimmed)) return "error";

  return "log";
}

function buildDaemonArgs(opts: SignalDaemonOptions): string[] {
  const args: string[] = [];
  if (opts.account) {
    args.push("-a", opts.account);
  }
  args.push("daemon");
  args.push("--http", `${opts.httpHost}:${opts.httpPort}`);
  args.push("--no-receive-stdout");

  if (opts.receiveMode) {
    args.push("--receive-mode", opts.receiveMode);
  }
  if (opts.ignoreAttachments) args.push("--ignore-attachments");
  if (opts.ignoreStories) args.push("--ignore-stories");
  if (opts.sendReadReceipts) args.push("--send-read-receipts");

  return args;
}

export function spawnSignalDaemon(opts: SignalDaemonOptions): SignalDaemonHandle {
  const args = buildDaemonArgs(opts);
  const child = spawn(opts.cliPath, args, {
    stdio: ["ignore", "pipe", "pipe"],
  });

  const log = opts.runtime?.log ?? (() => {});
  const error = opts.runtime?.error ?? (() => {});

  child.stdout?.on("data", (data) => {
    for (const line of data.toString().split(/\r?\n/)) {
      const kind = classifySignalCliLogLine(line);
      if (kind === "log") log(`signal-cli: ${line.trim()}`);
      else if (kind === "error") error(`signal-cli: ${line.trim()}`);
    }
  });

  child.stderr?.on("data", (data) => {
    for (const line of data.toString().split(/\r?\n/)) {
      const kind = classifySignalCliLogLine(line);
      if (kind === "log") log(`signal-cli: ${line.trim()}`);
      else if (kind === "error") error(`signal-cli: ${line.trim()}`);
    }
  });

  child.on("error", (err) => {
    error(`signal-cli spawn error: ${String(err)}`);
  });

  return {
    pid: child.pid ?? undefined,
    stop: () => {
      if (!child.killed) {
        child.kill("SIGTERM");
      }
    },
  };
}

export async function waitForSignalDaemonReady(
  baseUrl: string,
  timeoutMs: number = 30_000,
  runtime?: { log?: (msg: string) => void; error?: (msg: string) => void },
): Promise<void> {
  const startTime = Date.now();
  const log = runtime?.log ?? (() => {});
  const error = runtime?.error ?? (() => {});

  log(`Waiting for Signal daemon at ${baseUrl}...`);

  while (Date.now() - startTime < timeoutMs) {
    const res = await signalCheck(baseUrl, 1000);
    if (res.ok) {
      log("Signal daemon ready");
      return;
    }

    // Log after 5 seconds, then every 5 seconds
    const elapsed = Date.now() - startTime;
    if (elapsed > 5000 && elapsed % 5000 < 1000) {
      error(`Still waiting for Signal daemon... (${res.error})`);
    }

    await new Promise((r) => setTimeout(r, 150));
  }

  throw new Error(`Signal daemon did not become ready within ${timeoutMs}ms`);
}
