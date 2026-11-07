import pino, { type DestinationStream, type Logger } from "pino";
import { redactSecrets } from "./redact.js";

export function createLogger(opts: { level: string; stream?: DestinationStream }): Logger {
  return pino(
    {
      level: opts.level,
      formatters: { log: (obj) => redactSecrets(obj) },
    },
    opts.stream,
  );
}
