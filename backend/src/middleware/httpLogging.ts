import { pinoHttp } from "pino-http";
import { logger, safeError } from "../config/logger.js";

export function requestSummary(req: {
  method?: string;
  originalUrl?: string;
  url?: string;
  requestId?: string;
}) {
  return {
    id: req.requestId,
    method: req.method,
    path: (req.originalUrl || req.url || "/").split("?")[0].slice(0, 240),
  };
}
export const httpLogging = pinoHttp({
  logger,
  wrapSerializers: false,
  serializers: {
    req: requestSummary,
    res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
    err: safeError,
  },
  autoLogging: { ignore: (req) => req.url?.split("?")[0] === "/health" },
  customLogLevel: (_req, res, error) =>
    error || res.statusCode >= 500
      ? "error"
      : res.statusCode >= 400
        ? "warn"
        : "info",
  customSuccessMessage: (req) => `${req.method} request completed`,
  customErrorMessage: (req) => `${req.method} request failed`,
});
