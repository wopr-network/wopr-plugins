import { mkdirSync } from "node:fs";
import path from "node:path";
import winston from "winston";

const consoleFormat = winston.format.printf(({ level, message, timestamp, ...meta }) => {
  const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : "";
  return `${timestamp} [${level}] ${message}${metaStr}`;
});

const logDir = path.join(process.env.WOPR_HOME || "/tmp/wopr-test", "logs");
mkdirSync(logDir, { recursive: true });

export const logger = winston.createLogger({
  level: "debug",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json(),
  ),
  defaultMeta: { service: "wopr-plugin-matrix" },
  transports: [
    new winston.transports.File({
      filename: path.join(logDir, "matrix-plugin-error.log"),
      level: "error",
    }),
    new winston.transports.File({
      filename: path.join(logDir, "matrix-plugin.log"),
      level: "debug",
    }),
    new winston.transports.Console({
      format: winston.format.combine(winston.format.colorize(), consoleFormat),
      level: "warn",
    }),
  ],
});
