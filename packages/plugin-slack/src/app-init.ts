/**
 * Slack App Initialization
 *
 * Creates and configures the @slack/bolt App instance.
 * Supports both Socket Mode and HTTP webhook mode,
 * with optional OAuth for automatic token rotation.
 */

import crypto from "node:crypto";
import path from "node:path";
import { App, FileInstallationStore, LogLevel } from "@slack/bolt";
import type { Logger } from "winston";
import type { SlackConfig } from "./types.js";

/**
 * Build OAuth / token rotation options when credentials are provided.
 * Bolt 4 uses these to auto-refresh granular bot tokens (90-day expiry).
 */
export function buildOAuthOptions(config: SlackConfig, logger: Logger) {
  if (!config.clientId || !config.clientSecret) return {};

  const installDir = path.join(process.env.WOPR_HOME || "/tmp/wopr-test", "data", "slack-installations");

  let stateSecret = config.stateSecret;
  if (!stateSecret) {
    stateSecret = crypto.randomBytes(32).toString("hex");
    logger.warn(
      "No stateSecret configured for OAuth. Generated a random one — it will not persist across restarts. Set SLACK_STATE_SECRET or config.channels.slack.stateSecret for stable CSRF protection.",
    );
  }

  return {
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    stateSecret,
    installationStore: new FileInstallationStore({
      baseDir: installDir,
    }),
    tokenVerificationEnabled: true,
  };
}

/**
 * Initialize the Slack app (Socket Mode or HTTP)
 */
export async function initSlackApp(config: SlackConfig, logger: Logger): Promise<App> {
  const mode = config.mode || "socket";
  const oauthOpts = buildOAuthOptions(config, logger);
  const hasOAuth = "installationStore" in oauthOpts;

  if (mode === "socket") {
    if (!config.appToken) {
      throw new Error("App Token required for Socket Mode. Set channels.slack.appToken");
    }

    return new App({
      ...(hasOAuth ? {} : { token: config.botToken }),
      appToken: config.appToken,
      socketMode: true,
      logLevel: LogLevel.INFO,
      ...oauthOpts,
    });
  }

  // HTTP mode
  if (!config.signingSecret) {
    throw new Error("Signing Secret required for HTTP mode. Set channels.slack.signingSecret");
  }

  return new App({
    ...(hasOAuth ? {} : { token: config.botToken }),
    signingSecret: config.signingSecret,
    endpoints: config.webhookPath || "/slack/events",
    logLevel: LogLevel.INFO,
    ...oauthOpts,
  });
}
