import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleRoomMessage } from "../../src/event-handlers.js";
import type { MatrixRoomEvent } from "../../src/types.js";
import { createMockMatrixClient } from "../mocks/matrix-client.js";
import { createMockContext } from "../mocks/wopr-context.js";

function makeEvent(overrides: Partial<MatrixRoomEvent> = {}): MatrixRoomEvent {
  return {
    type: "m.room.message",
    sender: "@user:example.org",
    event_id: "$event123",
    room_id: "!room:example.org",
    origin_server_ts: Date.now(),
    content: {
      msgtype: "m.text",
      body: "Hello bot",
    },
    ...overrides,
  };
}

describe("handleRoomMessage", () => {
  let mockClient: ReturnType<typeof createMockMatrixClient>;
  let mockCtx: ReturnType<typeof createMockContext>;
  let mockQueueManager: {
    queueInject: ReturnType<typeof vi.fn>;
    getSessionState: ReturnType<typeof vi.fn>;
    cancelRoomQueue: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    mockClient = createMockMatrixClient();
    mockCtx = createMockContext();
    mockQueueManager = {
      queueInject: vi.fn(),
      getSessionState: vi.fn().mockReturnValue({ thinkingLevel: "medium", messageCount: 0 }),
      cancelRoomQueue: vi.fn(),
    };
    vi.clearAllMocks();
  });

  it("skips messages from the bot itself", async () => {
    mockClient.getUserId.mockResolvedValue("@bot:example.org");
    const event = makeEvent({ sender: "@bot:example.org" });

    await handleRoomMessage("!room:example.org", event, mockClient as never, mockCtx as never, mockQueueManager as never);

    expect(mockQueueManager.queueInject).not.toHaveBeenCalled();
  });

  it("skips events without msgtype", async () => {
    const event = makeEvent({ content: {} });

    await handleRoomMessage("!room:example.org", event, mockClient as never, mockCtx as never, mockQueueManager as never);

    expect(mockQueueManager.queueInject).not.toHaveBeenCalled();
  });

  it("responds in DMs (2-member rooms)", async () => {
    mockClient.getJoinedRoomMembers.mockResolvedValue(["@bot:example.org", "@user:example.org"]);

    const event = makeEvent({ content: { msgtype: "m.text", body: "Hey there" } });

    await handleRoomMessage("!room:example.org", event, mockClient as never, mockCtx as never, mockQueueManager as never);

    expect(mockQueueManager.queueInject).toHaveBeenCalled();
  });

  it("responds when bot is mentioned in group room", async () => {
    mockClient.getJoinedRoomMembers.mockResolvedValue(["@bot:example.org", "@user1:example.org", "@user2:example.org"]);
    mockClient.getUserProfile.mockResolvedValue({ displayname: "WOPR Bot" });

    const event = makeEvent({
      content: {
        msgtype: "m.text",
        body: "@bot:example.org what is the weather?",
      },
    });

    await handleRoomMessage("!room:example.org", event, mockClient as never, mockCtx as never, mockQueueManager as never);

    expect(mockQueueManager.queueInject).toHaveBeenCalled();
  });

  it("ignores non-mentioned messages in group rooms", async () => {
    mockClient.getJoinedRoomMembers.mockResolvedValue(["@bot:example.org", "@user1:example.org", "@user2:example.org"]);
    mockClient.getUserProfile.mockResolvedValue({ displayname: "WOPR Bot" });

    const event = makeEvent({
      content: {
        msgtype: "m.text",
        body: "Just chatting with friends",
      },
    });

    await handleRoomMessage("!room:example.org", event, mockClient as never, mockCtx as never, mockQueueManager as never);

    expect(mockQueueManager.queueInject).not.toHaveBeenCalled();
  });

  it("strips bot mention from message content", async () => {
    mockClient.getJoinedRoomMembers.mockResolvedValue(["@bot:example.org", "@user1:example.org", "@user2:example.org"]);
    mockClient.getUserProfile.mockResolvedValue({ displayname: "WOPR Bot" });

    const event = makeEvent({
      content: {
        msgtype: "m.text",
        body: "@bot:example.org what is 2+2?",
      },
    });

    await handleRoomMessage("!room:example.org", event, mockClient as never, mockCtx as never, mockQueueManager as never);

    expect(mockQueueManager.queueInject).toHaveBeenCalledWith(
      "!room:example.org",
      expect.objectContaining({
        messageContent: expect.not.stringContaining("@bot:example.org"),
      }),
    );
  });

  it("uses fallback message when mention has no content", async () => {
    mockClient.getJoinedRoomMembers.mockResolvedValue(["@bot:example.org", "@user1:example.org", "@user2:example.org"]);
    mockClient.getUserProfile.mockResolvedValue({ displayname: "WOPR Bot" });

    const event = makeEvent({
      content: {
        msgtype: "m.text",
        body: "@bot:example.org",
      },
    });

    await handleRoomMessage("!room:example.org", event, mockClient as never, mockCtx as never, mockQueueManager as never);

    expect(mockQueueManager.queueInject).toHaveBeenCalledWith(
      "!room:example.org",
      expect.objectContaining({
        messageContent: expect.stringContaining("Hello"),
      }),
    );
  });
});
