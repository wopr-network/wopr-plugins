import { describe, expect, it, vi } from "vitest";
import { uploadMedia, uploadMediaBuffer } from "../src/media-handler.js";

const mockClient = {
  uploadMedia: vi.fn().mockResolvedValue("media-123"),
  uploadMediaBuffer: vi.fn().mockResolvedValue("media-456"),
} as any;

describe("media-handler", () => {
  it("uploads an image file", async () => {
    const id = await uploadMedia(mockClient, "/tmp/photo.jpg", "image/jpeg");
    expect(id).toBe("media-123");
  });

  it("uploads a video file", async () => {
    const id = await uploadMedia(mockClient, "/tmp/video.mp4", "video/mp4");
    expect(id).toBe("media-123");
  });

  it("rejects unsupported mime type for file upload", async () => {
    await expect(uploadMedia(mockClient, "/tmp/file.txt", "text/plain")).rejects.toThrow("Unsupported media type");
  });

  it("uploads a buffer", async () => {
    const buf = Buffer.alloc(100);
    const id = await uploadMediaBuffer(mockClient, buf, "image/png");
    expect(id).toBe("media-456");
  });

  it("rejects oversized image buffer", async () => {
    const buf = Buffer.alloc(6 * 1024 * 1024); // 6 MB > 5 MB image limit
    await expect(uploadMediaBuffer(mockClient, buf, "image/png")).rejects.toThrow("File too large");
  });

  it("rejects unsupported mime type for buffer upload", async () => {
    const buf = Buffer.alloc(100);
    await expect(uploadMediaBuffer(mockClient, buf, "text/plain")).rejects.toThrow("Unsupported media type");
  });

  it("allows large video buffers up to 512 MB", async () => {
    // 100 bytes is well within video limit
    const buf = Buffer.alloc(100);
    const id = await uploadMediaBuffer(mockClient, buf, "video/mp4");
    expect(id).toBe("media-456");
  });
});
