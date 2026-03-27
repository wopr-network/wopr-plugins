import { redditChannelProvider } from "./channel-provider.js";
import { logger } from "./logger.js";
import type { ChannelMessageContext, ChannelRef, RedditInboundEvent, WOPRPluginContext } from "./types.js";

export async function handleRedditEvent(
  event: RedditInboundEvent,
  ctx: WOPRPluginContext,
  session: string,
  botUsername?: string,
): Promise<boolean> {
  // Skip own messages
  if (botUsername && event.author.toLowerCase() === botUsername.toLowerCase()) {
    return false;
  }

  // For DM events, check one-shot parsers first
  if (event.type === "dm") {
    const parsers = redditChannelProvider.getMessageParsers();
    for (const parser of parsers) {
      const matches =
        typeof parser.pattern === "function" ? parser.pattern(event.body) : (parser.pattern as RegExp).test(event.body);
      if (matches) {
        try {
          const msgCtx: ChannelMessageContext = {
            channel: `reddit:dm:${event.author}`,
            channelType: "reddit",
            sender: event.author,
            content: event.body,
            reply: async (msg: string) => {
              await redditChannelProvider.send(`reddit:dm:${event.author}`, msg);
            },
            getBotUsername: () => redditChannelProvider.getBotUsername(),
          };
          // biome-ignore lint/suspicious/noExplicitAny: handler may signal consumption via return value
          const consumed = (await parser.handler(msgCtx)) as unknown as boolean | undefined;
          if (consumed) return true;
        } catch (err) {
          logger.error({ msg: "Parser handler failed", error: String(err), parserId: parser.id });
        }
      }
    }
  }

  let channel: ChannelRef;
  if (event.type === "dm") {
    channel = { id: `reddit:dm:${event.author}`, type: "reddit", name: `DM from ${event.author}` };
  } else {
    const sub = event.subreddit ?? "unknown";
    channel = { id: `reddit:${sub}`, type: "reddit", name: `r/${sub}` };
  }

  logger.info({ msg: "Reddit event -> inject", type: event.type, author: event.author, id: event.id });

  try {
    await ctx.inject(session, event.body, {
      from: event.author,
      channel,
    });
  } catch (err) {
    logger.error({ msg: "Failed to inject Reddit event", error: String(err), eventId: event.id });
  }

  return false;
}
