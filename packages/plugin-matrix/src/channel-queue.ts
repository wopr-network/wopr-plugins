import { logger } from "./logger.js";

export interface QueuedInject {
  sessionKey: string;
  messageContent: string;
  authorDisplayName: string;
  roomId: string;
  eventId: string;
  queuedAt: number;
}

export interface SessionState {
  thinkingLevel: string;
  messageCount: number;
}

interface RoomQueue {
  processingChain: Promise<void>;
  currentInject: { cancelled: boolean } | null;
  generation: number;
}

export class RoomQueueManager {
  private roomQueues = new Map<string, RoomQueue>();
  private sessionStates = new Map<string, SessionState>();

  constructor(private executeInject: (item: QueuedInject, cancelToken: { cancelled: boolean }) => Promise<void>) {}

  private getRoomQueue(roomId: string): RoomQueue {
    let queue = this.roomQueues.get(roomId);
    if (!queue) {
      queue = {
        processingChain: Promise.resolve(),
        currentInject: null,
        generation: 0,
      };
      this.roomQueues.set(roomId, queue);
    }
    return queue;
  }

  getSessionState(sessionKey: string): SessionState {
    let state = this.sessionStates.get(sessionKey);
    if (!state) {
      state = {
        thinkingLevel: "medium",
        messageCount: 0,
      };
      this.sessionStates.set(sessionKey, state);
    }
    return state;
  }

  queueInject(roomId: string, item: QueuedInject): void {
    const queue = this.getRoomQueue(roomId);
    const capturedGeneration = queue.generation;

    queue.processingChain = queue.processingChain.then(async () => {
      // If the generation has advanced since this closure was enqueued, it means
      // cancelRoomQueue was called — skip execution entirely.
      const currentQueue = this.roomQueues.get(roomId);
      if (!currentQueue || currentQueue.generation !== capturedGeneration) {
        return;
      }

      const cancelToken = { cancelled: false };
      currentQueue.currentInject = cancelToken;

      try {
        await this.executeInject(item, cancelToken);
      } catch (error: unknown) {
        logger.error({ msg: "Queue inject failed", roomId, error: String(error) });
      } finally {
        if (currentQueue.currentInject === cancelToken) {
          currentQueue.currentInject = null;
        }
      }
    });

    logger.info({ msg: "Inject queued", roomId, from: item.authorDisplayName });
  }

  cancelRoomQueue(roomId: string): boolean {
    const queue = this.roomQueues.get(roomId);
    if (!queue) return false;

    // Cancel both the in-flight inject and invalidate any already-chained closures
    // by incrementing the generation counter. Closures that already hold a reference
    // to the old processingChain will check the generation before executing and bail.
    let hadSomething = false;
    if (queue.currentInject) {
      queue.currentInject.cancelled = true;
      hadSomething = true;
    }
    queue.generation += 1;
    this.roomQueues.delete(roomId);
    return hadSomething;
  }

  /** Wait for all room queues to finish processing their current chain. */
  async drain(): Promise<void> {
    const chains = Array.from(this.roomQueues.values()).map((q) => q.processingChain);
    await Promise.allSettled(chains);
  }
}
