import { createLogger, format, transports } from "winston";

export const logger = createLogger({
  level: "info",
  format: format.combine(format.timestamp(), format.json()),
  defaultMeta: { plugin: "wopr-plugin-superpower-company" },
  transports: [new transports.Console()],
});
