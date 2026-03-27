/**
 * Ambient module declaration for the optional @opencode-ai/sdk dependency.
 * The SDK is loaded dynamically at runtime; this declaration satisfies tsc.
 */
declare module "@opencode-ai/sdk" {
  export interface OpencodeClientInstance {
    session: {
      create(options: { body: { title: string } }): Promise<{ data?: { id: string } }>;
      prompt(options: { path: { id: string }; body: Record<string, unknown> }): Promise<{
        data?: {
          parts: Array<{ type: string; text?: string; name?: string }>;
        };
      }>;
    };
    global: {
      health(): Promise<{ data?: { healthy: boolean } }>;
    };
  }

  export function createOpencodeClient(options: { baseUrl: string; [key: string]: unknown }): OpencodeClientInstance;
}
