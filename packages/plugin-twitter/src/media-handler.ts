/**
 * Media upload helper for Twitter.
 * Wraps TwitterClient.uploadMedia with file validation.
 */

import { logger } from "./logger.js";
import type { TwitterClient } from "./twitter-client.js";

const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5 MB
const MAX_VIDEO_SIZE = 512 * 1024 * 1024; // 512 MB
const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];
const ALLOWED_VIDEO_TYPES = ["video/mp4", "video/quicktime"];

export async function uploadMedia(client: TwitterClient, filePath: string, mimeType: string): Promise<string> {
  if (ALLOWED_IMAGE_TYPES.includes(mimeType)) {
    // Image upload (simple)
    return client.uploadMedia(filePath, mimeType);
  }
  if (ALLOWED_VIDEO_TYPES.includes(mimeType)) {
    // Video upload (chunked — handled internally by twitter-api-v2)
    return client.uploadMedia(filePath, mimeType);
  }
  throw new Error(
    `Unsupported media type: ${mimeType}. Allowed: ${[...ALLOWED_IMAGE_TYPES, ...ALLOWED_VIDEO_TYPES].join(", ")}`,
  );
}

export async function uploadMediaBuffer(client: TwitterClient, buffer: Buffer, mimeType: string): Promise<string> {
  if (!ALLOWED_IMAGE_TYPES.includes(mimeType) && !ALLOWED_VIDEO_TYPES.includes(mimeType)) {
    throw new Error(`Unsupported media type: ${mimeType}`);
  }
  const maxSize = ALLOWED_IMAGE_TYPES.includes(mimeType) ? MAX_IMAGE_SIZE : MAX_VIDEO_SIZE;
  if (buffer.length > maxSize) {
    throw new Error(`File too large: ${buffer.length} bytes (max ${maxSize})`);
  }
  logger.debug({ msg: "Uploading media buffer", mimeType, size: buffer.length });
  return client.uploadMediaBuffer(buffer, mimeType);
}
