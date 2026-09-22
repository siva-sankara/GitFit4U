import type { RequestHandler } from "express";
import { randomUUID } from "node:crypto";

export const requestContext: RequestHandler = (req, res, next) => {
  const incoming = req.header("x-request-id");
  req.requestId = incoming && incoming.length < 128 ? incoming : randomUUID();
  res.setHeader("x-request-id", req.requestId);
  next();
};
