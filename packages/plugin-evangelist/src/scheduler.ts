import type { ScheduledPost } from "./types.js";

let counter = 0;

function generateId(): string {
  counter += 1;
  return `sched-${Date.now()}-${counter}`;
}

export class ContentScheduler {
  private posts: Map<string, ScheduledPost> = new Map();

  schedule(platform: ScheduledPost["platform"], content: string, scheduledAt: Date): ScheduledPost {
    const post: ScheduledPost = {
      id: generateId(),
      platform,
      content,
      scheduledAt: scheduledAt.toISOString(),
      status: "pending",
      createdAt: new Date().toISOString(),
    };
    this.posts.set(post.id, post);
    return post;
  }

  getDuePosts(): ScheduledPost[] {
    const now = new Date();
    return [...this.posts.values()].filter((p) => p.status === "pending" && new Date(p.scheduledAt) <= now);
  }

  markPosted(id: string): void {
    const post = this.posts.get(id);
    if (post) post.status = "posted";
  }

  markFailed(id: string): void {
    const post = this.posts.get(id);
    if (post) post.status = "failed";
  }

  getAll(): ScheduledPost[] {
    return [...this.posts.values()];
  }
}
