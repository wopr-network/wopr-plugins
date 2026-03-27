import { ApiClient } from "@twurple/api";
import type { AuthProvider } from "@twurple/auth";
import { EventSubWsListener } from "@twurple/eventsub-ws";
import type { ChannelRef, WOPRPluginContext } from "@wopr-network/plugin-types";

export class TwitchEventSubManager {
  private listener: EventSubWsListener | null = null;
  private apiClient: ApiClient | null = null;

  constructor(
    private ctx: WOPRPluginContext,
    private broadcasterId: string,
  ) {}

  async start(authProvider: AuthProvider): Promise<void> {
    this.apiClient = new ApiClient({ authProvider });
    this.listener = new EventSubWsListener({ apiClient: this.apiClient });

    this.listener.onChannelRedemptionAdd(this.broadcasterId, async (event) => {
      try {
        const channelRef: ChannelRef = {
          type: "twitch",
          id: `twitch:${this.broadcasterId}`,
          name: event.broadcasterDisplayName,
        };

        const sessionKey = `twitch-${this.broadcasterId}`;
        const message = `[Channel Point Redemption] ${event.userDisplayName} redeemed "${event.rewardTitle}" (${event.rewardCost} points)${event.input ? `: ${event.input}` : ""}`;

        this.ctx.logMessage(sessionKey, message, {
          from: event.userDisplayName,
          channel: channelRef,
        });

        if (event.input) {
          await this.ctx.inject(
            sessionKey,
            `[Channel Point: ${event.rewardTitle}] [${event.userDisplayName}]: ${event.input}`,
            {
              from: event.userDisplayName,
              channel: channelRef,
            },
          );

          if (this.apiClient) {
            try {
              await this.apiClient.channelPoints.updateRedemptionStatusByIds(
                this.broadcasterId,
                event.rewardId,
                [event.id],
                "FULFILLED",
              );
            } catch (error: unknown) {
              this.ctx.log.error(`Failed to fulfill redemption: ${error}`);
            }
          }
        }
      } catch (error: unknown) {
        this.ctx.log.error(`Unhandled error in channel redemption handler: ${error}`);
      }
    });

    await this.listener.start();
    this.ctx.log.info(`EventSub WebSocket started for broadcaster ${this.broadcasterId}`);
  }

  async stop(): Promise<void> {
    if (this.listener) {
      this.listener.stop();
      this.listener = null;
    }
    this.apiClient = null;
  }
}
