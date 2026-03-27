import { io, type Socket } from "socket.io-client";
import type {
  BBApiResponse,
  BBAttachment,
  BBChat,
  BBMessage,
  BBTypingNotification,
} from "./types.js";

export type BBEventHandler = (message: BBMessage) => void;
export type BBTypingHandler = (notification: BBTypingNotification) => void;

export class BlueBubblesClient {
  private socket: Socket | null = null;
  private serverUrl: string;
  private password: string;
  private onNewMessage: BBEventHandler | null = null;
  private onUpdatedMessage: BBEventHandler | null = null;
  private onTyping: BBTypingHandler | null = null;

  constructor(serverUrl: string, password: string) {
    this.serverUrl = serverUrl.replace(/\/+$/, "");
    this.password = password;
  }

  async connect(): Promise<void> {
    this.socket = io(this.serverUrl, {
      query: { guid: this.password },
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionDelay: 5000,
      reconnectionAttempts: Infinity,
    });

    this.socket.on("new-message", (data: BBMessage) => {
      this.onNewMessage?.(data);
    });

    this.socket.on("updated-message", (data: BBMessage) => {
      this.onUpdatedMessage?.(data);
    });

    this.socket.on("typing-indicator", (data: BBTypingNotification) => {
      this.onTyping?.(data);
    });

    return new Promise((resolve, reject) => {
      this.socket?.on("connect", () => resolve());
      this.socket?.on("connect_error", (err: Error) => reject(err));
    });
  }

  disconnect(): void {
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.disconnect();
      this.socket = null;
    }
  }

  setOnNewMessage(handler: BBEventHandler): void {
    this.onNewMessage = handler;
  }

  setOnUpdatedMessage(handler: BBEventHandler): void {
    this.onUpdatedMessage = handler;
  }

  setOnTyping(handler: BBTypingHandler): void {
    this.onTyping = handler;
  }

  private async apiRequest<T>(
    method: string,
    path: string,
    body?: Record<string, unknown>,
  ): Promise<BBApiResponse<T>> {
    const url = `${this.serverUrl}/api/v1${path}?password=${encodeURIComponent(this.password)}`;
    const options: RequestInit = {
      method,
      headers: { "Content-Type": "application/json" },
    };
    if (body) {
      options.body = JSON.stringify(body);
    }
    const res = await fetch(url, options);
    return (await res.json()) as BBApiResponse<T>;
  }

  async ping(): Promise<boolean> {
    const res = await this.apiRequest("GET", "/ping");
    return res.status === 200;
  }

  async sendText(
    chatGuid: string,
    message: string,
    opts?: {
      method?: "apple-script" | "private-api";
      replyToGuid?: string;
      tempGuid?: string;
    },
  ): Promise<BBApiResponse<BBMessage>> {
    return this.apiRequest<BBMessage>("POST", "/message/text", {
      chatGuid,
      message,
      method: opts?.method || "apple-script",
      tempGuid: opts?.tempGuid || crypto.randomUUID(),
      selectedMessageGuid: opts?.replyToGuid || undefined,
    });
  }

  async sendReaction(
    chatGuid: string,
    selectedMessageGuid: string,
    reaction: string,
    partIndex = 0,
  ): Promise<BBApiResponse<BBMessage>> {
    return this.apiRequest<BBMessage>("POST", "/message/react", {
      chatGuid,
      selectedMessageGuid,
      reaction,
      partIndex,
    });
  }

  async getChats(limit = 50, offset = 0): Promise<BBApiResponse<BBChat[]>> {
    return this.apiRequest<BBChat[]>("POST", "/chat/query", {
      limit,
      offset,
      with: ["lastMessage"],
      sort: "lastmessage",
    });
  }

  async getChatMessages(
    chatGuid: string,
    limit = 50,
    after?: number,
  ): Promise<BBApiResponse<BBMessage[]>> {
    return this.apiRequest<BBMessage[]>("POST", "/message/query", {
      chatGuid,
      limit,
      with: ["chat", "attachment", "handle"],
      sort: "DESC",
      after: after || undefined,
    });
  }

  async getAttachmentMeta(guid: string): Promise<BBApiResponse<BBAttachment>> {
    return this.apiRequest<BBAttachment>("GET", `/attachment/${encodeURIComponent(guid)}`);
  }

  async downloadAttachment(guid: string): Promise<Buffer> {
    const MAX_BYTES = 10 * 1024 * 1024; // 10MB
    const url = `${this.serverUrl}/api/v1/attachment/${encodeURIComponent(guid)}/download?password=${encodeURIComponent(this.password)}`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Attachment download failed: ${res.status} ${res.statusText}`);
    }
    const contentLength = res.headers?.get("Content-Length") ?? null;
    if (contentLength !== null && parseInt(contentLength, 10) > MAX_BYTES) {
      throw new Error(`Attachment exceeds 10MB size limit (Content-Length: ${contentLength})`);
    }
    if (res.body) {
      const chunks: Uint8Array[] = [];
      let totalBytes = 0;
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        totalBytes += value.length;
        if (totalBytes > MAX_BYTES) {
          await reader.cancel();
          throw new Error(`Attachment exceeds 10MB size limit`);
        }
        chunks.push(value);
      }
      return Buffer.concat(chunks);
    }
    const arrayBuf = await res.arrayBuffer();
    if (arrayBuf.byteLength > MAX_BYTES) {
      throw new Error(`Attachment exceeds 10MB size limit`);
    }
    return Buffer.from(arrayBuf);
  }

  async sendAttachment(
    chatGuid: string,
    fileBuffer: Buffer,
    filename: string,
  ): Promise<BBApiResponse<BBMessage>> {
    const url = `${this.serverUrl}/api/v1/message/attachment?password=${encodeURIComponent(this.password)}`;
    const formData = new FormData();
    formData.append("chatGuid", chatGuid);
    formData.append("tempGuid", crypto.randomUUID());
    formData.append("name", filename);
    formData.append("attachment", new Blob([fileBuffer]), filename);

    const res = await fetch(url, { method: "POST", body: formData });
    return (await res.json()) as BBApiResponse<BBMessage>;
  }

  async getServerInfo(): Promise<BBApiResponse<{ private_api: boolean }>> {
    return this.apiRequest<{ private_api: boolean }>("GET", "/server/info");
  }

  async markChatRead(chatGuid: string): Promise<BBApiResponse<void>> {
    return this.apiRequest<void>("POST", `/chat/${encodeURIComponent(chatGuid)}/read`);
  }
}
