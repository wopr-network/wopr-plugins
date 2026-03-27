/**
 * Winston logger for iMessage plugin
 */

import path from "node:path";
import winston from "winston";

const WOPR_HOME = process.env.WOPR_HOME || "/tmp/wopr-test";

export const logger = winston.createLogger({
  level: "debug",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json(),
  ),
  defaultMeta: { service: "wopr-plugin-imessage" },
  transports: [
    new winston.transports.File({
      filename: path.join(WOPR_HOME, "logs", "imessage-plugin-error.log"),
      level: "error",
    }),
    new winston.transports.File({
      filename: path.join(WOPR_HOME, "logs", "imessage-plugin.log"),
      level: "debug",
    }),
    new winston.transports.Console({
      format: winston.format.combine(winston.format.colorize(), winston.format.simple()),
      level: "warn",
    }),
  ],
});
