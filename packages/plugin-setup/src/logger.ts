import winston from "winston";

export const logger = winston.createLogger({
  level: "info",
  format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
  defaultMeta: { plugin: "wopr-plugin-setup" },
  transports: [new winston.transports.Console()],
});
