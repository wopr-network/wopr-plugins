import { beforeAll, describe, expect, it, vi } from "vitest";
import { saveAttachments } from "../../src/attachments.js";
import type { MatrixRoomEvent } from "../../src/types.js";
import { createMockMatrixClient } from "../mocks/matrix-client.js";

function makeMediaEvent(overrides: Partial<MatrixRoomEvent["content"]> = {}): MatrixRoomEvent {
  return {
    type: "m.room.message",
    sender: "@user:example.org",
    event_id: "$event123",
    room_id: "!room:example.org",
    origin_server_ts: Date.now(),
    content: {
      msgtype: "m.image",
      body: "image.png",
      url: "mxc://example.org/abc123",
      info: { mimetype: "image/png", size: 1024 },
      ...overrides,
    },
  };
}

describe("saveAttachments", () => {
  beforeAll(() => {
    process.env.WOPR_ATTACHMENTS_DIR = "/tmp/wopr-matrix-test-attachments";
  });
  it("returns empty array for events without url", async () => {
    const mockClient = createMockMatrixClient();
    const event = makeMediaEvent({ url: undefined });

    const result = await saveAttachments(mockClient as never, event);
    expect(result).toEqual([]);
    expect(mockClient.downloadContent).not.toHaveBeenCalled();
  });

  it("returns empty array for invalid (non-mxc) urls", async () => {
    const mockClient = createMockMatrixClient();
    const event = makeMediaEvent({ url: "https://example.com/image.png" });

    const result = await saveAttachments(mockClient as never, event);
    expect(result).toEqual([]);
    expect(mockClient.downloadContent).not.toHaveBeenCalled();
  });

  it("downloads content from mxc:// urls", async () => {
    const mockClient = createMockMatrixClient({
      downloadContent: vi.fn().mockResolvedValue({ data: Buffer.from("image data") }),
    });
    const event = makeMediaEvent();

    const result = await saveAttachments(mockClient as never, event);
    expect(mockClient.downloadContent).toHaveBeenCalledWith("mxc://example.org/abc123");
    expect(result).toHaveLength(1);
    expect(result[0]).toMatch(/\.png$/);
  });

  it("handles download errors gracefully and returns empty array", async () => {
    const mockClient = createMockMatrixClient({
      downloadContent: vi.fn().mockRejectedValue(new Error("Network error")),
    });
    const event = makeMediaEvent();

    const result = await saveAttachments(mockClient as never, event);
    expect(result).toEqual([]);
  });

  it("uses correct file extension from mimetype", async () => {
    const mockClient = createMockMatrixClient({
      downloadContent: vi.fn().mockResolvedValue({ data: Buffer.from("audio data") }),
    });
    const event = makeMediaEvent({ url: "mxc://example.org/audio123", info: { mimetype: "audio/ogg" } });

    const result = await saveAttachments(mockClient as never, event);
    expect(result[0]).toMatch(/\.ogg$/);
  });
});
