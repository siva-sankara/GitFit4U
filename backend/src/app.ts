import express from "express";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";
import { env } from "./config/env.js";
import { httpLogging } from "./middleware/httpLogging.js";
import { razorpayWebhook } from "./controllers/checkoutController.js";
import { apiRoutes } from "./routes/index.js";
import { requestContext } from "./middleware/requestContext.js";
import { notFound } from "./middleware/notFound.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { rejectUnsafeKeys } from "./middleware/rejectUnsafeKeys.js";
import { openapi } from "./docs/openapi.js";

export const app = express();

app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(requestContext);
app.use(httpLogging);
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
  }),
);
app.use(
  cors({
    origin: env.CLIENT_ORIGIN.split(",").map((origin) => origin.trim()),
    credentials: true,
    methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "content-type",
      "authorization",
      "idempotency-key",
      "x-request-id",
      "x-csrf-protection",
    ],
  }),
);

app.post(
  "/api/v1/webhooks/razorpay",
  express.raw({ type: "application/json", limit: "512kb" }),
  razorpayWebhook,
);

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false, limit: "100kb" }));
app.use(rejectUnsafeKeys);
app.use(cookieParser());
app.use(compression());
app.use(
  rateLimit({
    windowMs: 60_000,
    limit: 180,
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) =>
      req.path.startsWith("/health") ||
      req.path.startsWith("/api/v1/locations/tiles/"),
  }),
);

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    service: "getfit4u-api",
    timestamp: new Date().toISOString(),
  });
});
if (env.NODE_ENV !== "production") {
  app.get("/api-docs.json", (_req, res) => res.json(openapi));
  app.get("/api-docs", (_req, res) =>
    res
      .type("html")
      .send(
        `<!doctype html><html><head><title>GETFIT4U API</title><link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css"></head><body><div id="swagger-ui"></div><script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js"></script><script>SwaggerUIBundle({url:'/api-docs.json',dom_id:'#swagger-ui'})</script></body></html>`,
      ),
  );
}
app.use("/api/v1", apiRoutes);
app.use(notFound);
app.use(errorHandler);
