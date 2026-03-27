import winston from "winston";

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL ?? "info",
  format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
  defaultMeta: { plugin: "wopr-plugin-mcp" },
  transports: [new winston.transports.Console()],
});
