/**
 * iMessage RPC Client
 *
 * Spawns imsg CLI in RPC mode and communicates via JSON-RPC over stdio
 */
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { logger } from "./logger.js";
import type { IncomingMessage, JsonRpcNotification, JsonRpcRequest } from "./types.js";

interface PendingRequest {
  resolve: (value: any) => void;
  reject: (error: Error) => void;
  timer?: NodeJS.Timeout;
}

interface IMessageClientOptions {
  cliPath?: string;
  dbPath?: string;
  onMessage?: (msg: IncomingMessage) => void;
  onError?: (error: Error) => void;
}

export class IMessageClient {
  private cliPath: string;
  private dbPath?: string;
  private onMessage?: (msg: IncomingMessage) => void;
  private onError?: (error: Error) => void;

  private child: ReturnType<typeof spawn> | null = null;
  private reader: ReturnType<typeof createInterface> | null = null;
  private pending = new Map<string, PendingRequest>();
  private nextId = 1;
  private closed = false;
  private closedResolve: (() => void) | null = null;
  private closedPromise: Promise<void>;

  constructor(opts: IMessageClientOptions = {}) {
    this.cliPath = opts.cliPath?.trim() || "imsg";
    this.dbPath = opts.dbPath?.trim();
    this.onMessage = opts.onMessage;
    this.onError = opts.onError;

    this.closedPromise = new Promise((resolve) => {
      this.closedResolve = resolve;
    });
  }

  async start(): Promise<void> {
    if (this.child) {
      logger.warn("imsg client already started");
      return;
    }

    const args = ["rpc"];
    if (this.dbPath) {
      args.push("--db", this.dbPath);
    }

    logger.info(`Starting imsg rpc: ${this.cliPath} ${args.join(" ")}`);

    this.child = spawn(this.cliPath, args, {
      stdio: ["pipe", "pipe", "pipe"],
    });

    // Handle stdout (JSON-RPC responses/notifications)
    this.reader = createInterface({ input: this.child.stdout! });
    this.reader.on("line", (line) => {
      this.handleLine(line);
    });

    // Handle stderr (logs)
    this.child.stderr?.on("data", (chunk) => {
      const lines = chunk.toString().split(/\r?\n/);
      for (const line of lines) {
        if (line.trim()) {
          logger.debug(`imsg stderr: ${line.trim()}`);
        }
      }
    });

    // Handle process errors
    this.child.on("error", (err) => {
      logger.error({ msg: "imsg process error", error: err.message });
      this.failAll(err);
      this.closedResolve?.();
    });

    // Handle process close
    this.child.on("close", (code, signal) => {
      if (code !== 0 && code !== null) {
        const reason = signal ? `signal ${signal}` : `code ${code}`;
        logger.error({ msg: `imsg process exited (${reason})` });
        this.failAll(new Error(`imsg exited (${reason})`));
      } else {
        logger.info("imsg process closed");
        this.failAll(new Error("imsg closed"));
      }
      this.closedResolve?.();
    });

    // Wait a moment for startup
    await new Promise((r) => setTimeout(r, 500));

    if (!this.child || this.child.killed) {
      throw new Error("Failed to start imsg rpc");
    }

    logger.info("imsg rpc started successfully");
  }

  async stop(): Promise<void> {
    if (!this.child) return;

    logger.info("Stopping imsg rpc...");
    this.closed = true;

    // Close reader
    this.reader?.close();
    this.reader = null;

    // End stdin to signal graceful shutdown
    this.child.stdin?.end();

    // Wait for process to exit or timeout
    const child = this.child;
    this.child = null;

    await Promise.race([
      this.closedPromise,
      new Promise<void>((resolve) => {
        setTimeout(() => {
          if (!child.killed) {
            child.kill("SIGTERM");
          }
          resolve();
        }, 2000);
      }),
    ]);

    logger.info("imsg rpc stopped");
  }

  async request(method: string, params?: Record<string, any>, timeoutMs = 30000): Promise<any> {
    if (!this.child?.stdin) {
      throw new Error("imsg rpc not running");
    }

    const id = this.nextId++;
    const request: JsonRpcRequest = {
      jsonrpc: "2.0",
      id,
      method,
      params: params ?? {},
    };

    const line = `${JSON.stringify(request)}\n`;

    return new Promise((resolve, reject) => {
      const key = String(id);

      const timer =
        timeoutMs > 0
          ? setTimeout(() => {
              this.pending.delete(key);
              reject(new Error(`imsg rpc timeout (${method})`));
            }, timeoutMs)
          : undefined;

      this.pending.set(key, { resolve, reject, timer });

      this.child?.stdin?.write(line, (err) => {
        if (err) {
          this.pending.delete(key);
          clearTimeout(timer);
          reject(err);
        }
      });
    });
  }

  async sendMessage(params: {
    text: string;
    to?: string;
    chat_id?: number;
    chat_guid?: string;
    chat_identifier?: string;
    service?: string;
    region?: string;
    file?: string;
  }): Promise<{ messageId?: string }> {
    const result = await this.request("send", params, 60000);

    // Extract message ID from various possible result formats
    const messageId =
      result?.messageId || result?.message_id || result?.id || result?.guid || (result?.ok ? "ok" : undefined);

    return { messageId };
  }

  async listChats(limit = 20): Promise<any[]> {
    return this.request("chats", { limit }, 10000);
  }

  async getChatHistory(chatId: number, limit = 50): Promise<any[]> {
    return this.request("history", { chat_id: chatId, limit }, 10000);
  }

  private handleLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) return;

    let parsed: any;
    try {
      parsed = JSON.parse(trimmed);
    } catch (_err) {
      logger.warn({
        msg: "Failed to parse imsg JSON",
        line: trimmed.substring(0, 200),
      });
      return;
    }

    // Handle responses (have id)
    if (parsed.id !== undefined && parsed.id !== null) {
      const key = String(parsed.id);
      const pending = this.pending.get(key);
      if (!pending) return;

      if (pending.timer) clearTimeout(pending.timer);
      this.pending.delete(key);

      if (parsed.error) {
        const baseMessage = parsed.error.message ?? "imsg rpc error";
        const details = parsed.error.data;
        const code = parsed.error.code;
        const suffixes: string[] = [];

        if (typeof code === "number") suffixes.push(`code=${code}`);
        if (details !== undefined) {
          const detailText = typeof details === "string" ? details : JSON.stringify(details);
          if (detailText) suffixes.push(detailText);
        }

        const msg = suffixes.length > 0 ? `${baseMessage}: ${suffixes.join(" ")}` : baseMessage;
        pending.reject(new Error(msg));
      } else {
        pending.resolve(parsed.result);
      }
      return;
    }

    // Handle notifications (no id)
    if (parsed.method) {
      this.handleNotification(parsed as JsonRpcNotification);
    }
  }

  private handleNotification(notification: JsonRpcNotification): void {
    logger.debug({
      msg: "imsg notification",
      method: notification.method,
      params: notification.params,
    });

    switch (notification.method) {
      case "message":
      case "message.received":
        if (notification.params && this.onMessage) {
          this.onMessage(notification.params as IncomingMessage);
        }
        break;
      case "error":
        logger.error({
          msg: "imsg error notification",
          error: notification.params,
        });
        this.onError?.(new Error(String(notification.params?.message || "Unknown imsg error")));
        break;
      default:
        logger.debug({
          msg: "Unknown imsg notification",
          method: notification.method,
        });
    }
  }

  private failAll(error: Error): void {
    for (const [key, pending] of this.pending) {
      if (pending.timer) clearTimeout(pending.timer);
      pending.reject(error);
      this.pending.delete(key);
    }
  }

  isRunning(): boolean {
    return !!this.child && !this.child.killed && !this.closed;
  }
}
