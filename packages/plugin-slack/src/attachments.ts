/**
 * Attachment handling
 *
 * Downloads and saves Slack file attachments to the local filesystem.
 * Slack files require the bot token in the Authorization header (unlike Discord's public URLs).
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Logger } from "winston";

/** Slack file object shape (subset of fields we use) */
export interface SlackFile {
  id: string;
  name?: string;
  url_private_download?: string;
  url_private?: string;
  size?: number;
  mimetype?: string;
}

// Attachments directory (same convention as Discord plugin)
const ATTACHMENTS_DIR = existsSync("/data")
  ? "/data/attachments"
  : path.join(process.env.WOPR_HOME || "/tmp/wopr-test", "data", "attachments");

/**
 * Download Slack file attachments to disk.
 * Slack files require the bot token in the Authorization header.
 * Returns an array of saved file paths.
 */
export async function saveAttachments(
  files: SlackFile[],
  userId: string,
  botToken: string,
  logger: Logger,
): Promise<string[]> {
  if (!files || files.length === 0) return [];

  try {
    if (!existsSync(ATTACHMENTS_DIR)) {
      mkdirSync(ATTACHMENTS_DIR, { recursive: true });
    }
  } catch (error: unknown) {
    logger.error({
      msg: "Failed to create attachments directory",
      dir: ATTACHMENTS_DIR,
      error: String(error),
    });
    return [];
  }

  const savedPaths: string[] = [];

  for (const file of files) {
    const downloadUrl = file.url_private_download || file.url_private;
    if (!downloadUrl) {
      logger.warn({ msg: "Slack file has no download URL", fileId: file.id });
      continue;
    }

    try {
      const timestamp = Date.now();
      const safeName = file.name?.replace(/[^a-zA-Z0-9._-]/g, "_") || "attachment";
      const filename = `${timestamp}-${userId}-${safeName}`;
      const filepath = path.join(ATTACHMENTS_DIR, filename);

      const response = await fetch(downloadUrl, {
        headers: { Authorization: `Bearer ${botToken}` },
      });

      if (!response.ok) {
        logger.warn({
          msg: "Failed to download Slack file",
          fileId: file.id,
          url: downloadUrl,
          status: response.status,
        });
        continue;
      }

      const arrayBuf = await response.arrayBuffer();
      writeFileSync(filepath, Buffer.from(arrayBuf));

      savedPaths.push(filepath);
      logger.info({
        msg: "Slack attachment saved",
        filename,
        size: file.size,
        mimetype: file.mimetype,
      });
    } catch (error: unknown) {
      logger.error({
        msg: "Error saving Slack attachment",
        fileId: file.id,
        name: file.name,
        error: String(error),
      });
    }
  }

  return savedPaths;
}
