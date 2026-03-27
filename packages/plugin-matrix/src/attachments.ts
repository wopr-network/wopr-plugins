import { existsSync, mkdirSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { MatrixClient } from "matrix-bot-sdk";
import { logger } from "./logger.js";

interface MatrixRoomEvent {
  type: string;
  sender: string;
  event_id: string;
  room_id: string;
  origin_server_ts: number;
  content: {
    msgtype?: string;
    body?: string;
    formatted_body?: string;
    format?: string;
    url?: string;
    info?: { mimetype?: string; size?: number; w?: number; h?: number };
    "m.relates_to"?: { "m.in_reply_to"?: { event_id: string } };
  };
}

function getAttachmentsDir(): string {
  if (process.env.WOPR_ATTACHMENTS_DIR) return process.env.WOPR_ATTACHMENTS_DIR;
  if (existsSync("/data")) return "/data/attachments";
  return path.join(process.env.WOPR_HOME || process.cwd(), "attachments");
}

/**
 * Download media attachments from a Matrix message event.
 * Returns array of local file paths.
 */
export async function saveAttachments(client: MatrixClient, event: MatrixRoomEvent): Promise<string[]> {
  const content = event.content;
  if (!content.url) return [];

  const mxcUrl = content.url;
  if (!mxcUrl.startsWith("mxc://")) {
    logger.warn({ msg: "Invalid media URL", url: mxcUrl });
    return [];
  }

  const attachmentsDir = getAttachmentsDir();

  if (!existsSync(attachmentsDir)) {
    mkdirSync(attachmentsDir, { recursive: true });
  }

  try {
    const mimetype = content.info?.mimetype || "application/octet-stream";
    const ext = getExtFromMimetype(mimetype);
    const timestamp = Date.now();
    const safeSender = event.sender.replace(/[^a-zA-Z0-9._-]/g, "_");
    const filename = `${timestamp}-${safeSender}${ext}`;
    const filepath = path.join(attachmentsDir, filename);

    const data = await client.downloadContent(mxcUrl);
    const buffer = Buffer.isBuffer(data.data) ? data.data : Buffer.from(data.data);

    await writeFile(filepath, buffer);

    logger.info({
      msg: "Matrix attachment saved",
      filename,
      mimetype,
      size: buffer.length,
    });

    return [filepath];
  } catch (error: unknown) {
    logger.error({ msg: "Error saving Matrix attachment", mxcUrl, error: String(error) });
    return [];
  }
}

/**
 * Upload a local file to Matrix and return the mxc:// URI.
 */
export async function uploadFile(client: MatrixClient, filePath: string, contentType: string): Promise<string> {
  const fileData = await readFile(filePath);
  const fileName = path.basename(filePath);
  const mxcUrl = await client.uploadContent(fileData, contentType, fileName);
  logger.info({ msg: "File uploaded to Matrix", filePath, mxcUrl });
  return mxcUrl;
}

function getExtFromMimetype(mimetype: string): string {
  const map: Record<string, string> = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/gif": ".gif",
    "image/webp": ".webp",
    "audio/ogg": ".ogg",
    "audio/mpeg": ".mp3",
    "video/mp4": ".mp4",
    "application/pdf": ".pdf",
  };
  return map[mimetype] || "";
}
