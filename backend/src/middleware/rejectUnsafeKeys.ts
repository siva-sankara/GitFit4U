import type { RequestHandler } from "express";
import { AppError } from "../utils/AppError.js";
function inspect(value: unknown): boolean { if (!value || typeof value !== "object") return false; if (Array.isArray(value)) return value.some(inspect); return Object.entries(value as Record<string, unknown>).some(([key, child]) => key.startsWith("$") || key.includes(".") || inspect(child)); }
export const rejectUnsafeKeys: RequestHandler = (req, _res, next) => inspect(req.body) ? next(new AppError(400,"UNSAFE_INPUT","Request contains unsupported field names.")) : next();
