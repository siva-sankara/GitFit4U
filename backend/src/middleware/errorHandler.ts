import type { ErrorRequestHandler } from "express";
import mongoose from "mongoose";
import { ZodError } from "zod";
import { logger } from "../config/logger.js";
import { AppError } from "../utils/AppError.js";

export const errorHandler: ErrorRequestHandler = (error, req, res, _next) => {
  let appError = error;
  if (error?.type === "entity.too.large") {
    appError = new AppError(
      413,
      "UPLOAD_TOO_LARGE",
      "The uploaded file exceeds the allowed size.",
    );
  } else if (error?.type === "entity.parse.failed") {
    appError = new AppError(
      400,
      "INVALID_BODY",
      "The request body is not valid JSON.",
    );
  } else if (
    ["TokenExpiredError", "JsonWebTokenError", "NotBeforeError"].includes(
      error?.name,
    )
  ) {
    appError = new AppError(401, "SESSION_EXPIRED", "Please sign in again.");
  } else if (error instanceof mongoose.Error.ValidationError) {
    appError = new AppError(
      422,
      "VALIDATION_ERROR",
      Object.values(error.errors)
        .map((value) => value.message)
        .join(" "),
    );
  } else if (error instanceof mongoose.Error.CastError) {
    appError = new AppError(
      400,
      "INVALID_IDENTIFIER",
      "The supplied identifier is invalid.",
    );
  } else if (error instanceof ZodError) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of error.issues) {
      const path =
        issue.path
          .filter((part) => !["body", "params", "query"].includes(String(part)))
          .join(".") || "form";
      (fieldErrors[path] ||= []).push(issue.message);
    }
    appError = new AppError(
      422,
      "VALIDATION_ERROR",
      error.issues[0]?.message || "Review the highlighted fields.",
      { fieldErrors },
    );
  } else if ((error as { code?: number }).code === 11000) {
    appError = new AppError(
      409,
      "DUPLICATE_RECORD",
      "This record already exists.",
    );
  }

  const statusCode = appError instanceof AppError ? appError.statusCode : 500;
  const code = appError instanceof AppError ? appError.code : "INTERNAL_ERROR";
  const message =
    appError instanceof AppError
      ? appError.message
      : "An unexpected error occurred.";
  const details = appError instanceof AppError ? appError.details : undefined;

  if (statusCode >= 500) {
    logger.error(
      { err: error, requestId: req.requestId, path: req.path },
      "request failed",
    );
  } else if (statusCode === 401) {
    logger.warn(
      {
        event: "authentication_rejected",
        code,
        requestId: req.requestId,
        path: req.path,
      },
      "authentication request rejected",
    );
  }

  res.status(statusCode).json({
    success: false,
    error: { code, message, details, requestId: req.requestId },
  });
};
