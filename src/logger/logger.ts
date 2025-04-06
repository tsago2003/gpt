import { createLogger, format, transports } from "winston";

export const logger = createLogger({
  level: "info",
  format: format.combine(
    format.timestamp(),
    format.printf(({ timestamp, level, message, service }) => {
      return `${timestamp} - ${service} - ${level} - ${message}`;
    })
  ),
  defaultMeta: { service: "youtube_summary" },
  transports: [
    new transports.Console(),
    new transports.File({ filename: "logs/combined.log" }),
  ],
});
