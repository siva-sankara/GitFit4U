import type { RequestHandler } from "express";
import { AppError } from "../utils/AppError.js";

export const notFound: RequestHandler = (req, _res, next) => {
  next(new AppError(404, "ROUTE_NOT_FOUND", `No route matches ${req.method} ${req.originalUrl}.`));
};
