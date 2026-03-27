import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

// Mock socket.io-client before importing the client
vi.mock("socket.io-client", () => {
  const mockSocket = {
    on: vi.fn(),
    emit: vi.fn(),
    disconnect: vi.fn(),
    removeAllListeners: vi.fn(),
    connected: true,
  };
  return {
    io: vi.fn().mockReturnValue(mockSocket),
  };
});

import { io } from "socket.io-client";
import { BlueBubblesClient } from "../../src/bluebubbles-client.js";

const mockIo = vi.mocked(io);

function getMockSocket() {
  return mockIo.mock.results[0]?.value as {
    on: ReturnType<typeof vi.fn>;
    emit: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
    removeAllListeners: ReturnType<typeof vi.fn>;
    connected: boolean;
  };
}

describe("BlueBubblesClient", () => {
  const serverUrl = "http://192.168.1.100:1234";
  const password = "test-password";
  let client: BlueBubblesClient;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    client = new BlueBubblesClient(serverUrl, password);
    mockFetch = vi.fn();
    globalThis.fetch = mockFetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("constructor", () => {
    it("strips trailing slash from serverUrl", () => {
      const c = new BlueBubblesClient("http://192.168.1.100:1234/", password);
      // We verify via the URL used in apiRequest
      mockFetch.mockResolvedValueOnce({
        json: async () => ({ status: 200, message: "pong" }),
      });
      c.ping();
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("http://192.168.1.100:1234/api/v1"),
        expect.any(Object)
      );
    });
  });

  describe("connect()", () => {
    it("calls io() with the correct URL and query params", async () => {
      // Simulate the connect event being fired
      const connectSpy = vi.fn();
      const mockSocket = {
        on: vi.fn().mockImplementation((event: string, handler: () => void) => {
          if (event === "connect") handler();
        }),
        emit: vi.fn(),
        disconnect: vi.fn(),
        removeAllListeners: vi.fn(),
        connected: true,
      };
      mockIo.mockReturnValueOnce(mockSocket as any);

      await client.connect();

      expect(mockIo).toHaveBeenCalledWith(
        serverUrl,
        expect.objectContaining({
          query: { guid: password },
          transports: expect.arrayContaining(["websocket"]),
          reconnection: true,
        })
      );
    });

    it("registers new-message, updated-message, and typing-indicator event listeners", async () => {
      const mockSocket = {
        on: vi.fn().mockImplementation((event: string, handler: () => void) => {
          if (event === "connect") handler();
        }),
        emit: vi.fn(),
        disconnect: vi.fn(),
        removeAllListeners: vi.fn(),
        connected: true,
      };
      mockIo.mockReturnValueOnce(mockSocket as any);

      await client.connect();

      const registeredEvents = mockSocket.on.mock.calls.map((call: any[]) => call[0]);
      expect(registeredEvents).toContain("new-message");
      expect(registeredEvents).toContain("updated-message");
      expect(registeredEvents).toContain("typing-indicator");
    });
  });

  describe("disconnect()", () => {
    it("calls socket.disconnect() and removeAllListeners()", async () => {
      const mockSocket = {
        on: vi.fn().mockImplementation((event: string, handler: () => void) => {
          if (event === "connect") handler();
        }),
        emit: vi.fn(),
        disconnect: vi.fn(),
        removeAllListeners: vi.fn(),
        connected: true,
      };
      mockIo.mockReturnValueOnce(mockSocket as any);

      await client.connect();
      client.disconnect();

      expect(mockSocket.removeAllListeners).toHaveBeenCalled();
      expect(mockSocket.disconnect).toHaveBeenCalled();
    });

    it("does nothing when no socket has been connected", () => {
      // Should not throw
      expect(() => client.disconnect()).not.toThrow();
    });
  });

  describe("ping()", () => {
    it("calls fetch with correct URL including password and returns true for status 200", async () => {
      mockFetch.mockResolvedValueOnce({
        json: async () => ({ status: 200, message: "pong" }),
      });

      const result = await client.ping();

      expect(mockFetch).toHaveBeenCalledWith(
        `${serverUrl}/api/v1/ping?password=${encodeURIComponent(password)}`,
        expect.objectContaining({ method: "GET" })
      );
      expect(result).toBe(true);
    });

    it("returns false for non-200 status", async () => {
      mockFetch.mockResolvedValueOnce({
        json: async () => ({ status: 500, message: "error" }),
      });

      const result = await client.ping();
      expect(result).toBe(false);
    });
  });

  describe("sendText()", () => {
    it("sends POST to /api/v1/message/text with correct body", async () => {
      mockFetch.mockResolvedValueOnce({
        json: async () => ({ status: 200, data: {} }),
      });

      await client.sendText("iMessage;-;+15551234567", "Hello world");

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/v1/message/text"),
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining("Hello world"),
        })
      );

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.chatGuid).toBe("iMessage;-;+15551234567");
      expect(body.message).toBe("Hello world");
      expect(body.method).toBe("apple-script");
      expect(body.tempGuid).toBeDefined();
    });

    it("passes replyToGuid as selectedMessageGuid when provided", async () => {
      mockFetch.mockResolvedValueOnce({
        json: async () => ({ status: 200, data: {} }),
      });

      await client.sendText("iMessage;-;+15551234567", "Reply", {
        replyToGuid: "msg-guid-123",
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.selectedMessageGuid).toBe("msg-guid-123");
    });
  });

  describe("sendReaction()", () => {
    it("sends POST to /api/v1/message/react with correct body", async () => {
      mockFetch.mockResolvedValueOnce({
        json: async () => ({ status: 200, data: {} }),
      });

      await client.sendReaction("iMessage;-;+15551234567", "msg-guid", "+like");

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/v1/message/react"),
        expect.objectContaining({ method: "POST" })
      );

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.chatGuid).toBe("iMessage;-;+15551234567");
      expect(body.selectedMessageGuid).toBe("msg-guid");
      expect(body.reaction).toBe("+like");
      expect(body.partIndex).toBe(0);
    });
  });

  describe("downloadAttachment()", () => {
    it("calls correct URL and returns Buffer", async () => {
      const fakeData = new Uint8Array([1, 2, 3, 4]);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => fakeData.buffer,
      });

      const result = await client.downloadAttachment("attachment-guid-123");

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining(
          `/api/v1/attachment/${encodeURIComponent("attachment-guid-123")}/download`
        )
      );
      expect(result).toBeInstanceOf(Buffer);
      expect(result.length).toBe(4);
    });

    it("throws when download fails", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: "Not Found",
      });

      await expect(client.downloadAttachment("guid")).rejects.toThrow(
        "Attachment download failed"
      );
    });
  });

  describe("getServerInfo()", () => {
    it("calls GET /api/v1/server/info", async () => {
      mockFetch.mockResolvedValueOnce({
        json: async () => ({ status: 200, data: { private_api: true } }),
      });

      const result = await client.getServerInfo();

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/v1/server/info"),
        expect.objectContaining({ method: "GET" })
      );
      expect(result.data?.private_api).toBe(true);
    });
  });

  describe("markChatRead()", () => {
    it("calls POST /api/v1/chat/:guid/read", async () => {
      mockFetch.mockResolvedValueOnce({
        json: async () => ({ status: 200 }),
      });

      await client.markChatRead("iMessage;-;+15551234567");

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining(
          `/api/v1/chat/${encodeURIComponent("iMessage;-;+15551234567")}/read`
        ),
        expect.objectContaining({ method: "POST" })
      );
    });
  });
});
