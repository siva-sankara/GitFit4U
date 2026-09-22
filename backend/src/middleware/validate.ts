import type { RequestHandler } from "express";
import type { ZodType } from "zod";
import { AppError } from "../utils/AppError.js";

export function validate(schema: ZodType): RequestHandler {
  return (req, _res, next) => {
    const result = schema.safeParse({ body: req.body, params: req.params, query: req.query });
    if (!result.success) {
      return next(
        new AppError(422, "VALIDATION_ERROR", "Please correct the highlighted fields.", result.error.flatten())
      );
    }
    const data = result.data as { body?: unknown; params?: unknown; query?: unknown };
    if (data.body !== undefined) req.body = data.body;
    if (data.params !== undefined) req.params = data.params as typeof req.params;
    if (data.query !== undefined) {
      // Express 5 exposes query through a getter. Keep the parsed values on this request.
      Object.defineProperty(req, "query", {
        value: data.query,
        writable: true,
        enumerable: true,
        configurable: true
      });
    }
    next();
  };
}
