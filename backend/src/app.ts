import express, { type RequestHandler } from "express";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";
import { env } from "./config/env.js";
import { logger } from "./config/logger.js";
import { connectDatabase } from "./config/db.js";
import { httpLogging } from "./middleware/httpLogging.js";
import { razorpayWebhook } from "./controllers/checkoutController.js";
import { webhook as whatsappWebhook, webhookChallenge as whatsappWebhookChallenge } from "./controllers/whatsappController.js";
import { apiRoutes } from "./routes/index.js";
import { requestContext } from "./middleware/requestContext.js";
import { notFound } from "./middleware/notFound.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { rejectUnsafeKeys } from "./middleware/rejectUnsafeKeys.js";
import { openapi } from "./docs/openapi.js";
import { AppError } from "./utils/AppError.js";

export const app = express();

// Vercel invokes this app directly, without running the standalone server startup.
const ensureDatabase: RequestHandler = async (_req, _res, next) => {
  await connectDatabase();
  next();
};

app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(requestContext);
app.use(httpLogging);
app.use((req, res, next) => {
  if (env.OTP_MODE !== "development_preview") return next();
  const peer = req.socket.remoteAddress || "";
  const local = ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(peer);
  if (!local || !["localhost", "127.0.0.1", "[::1]"].includes(req.hostname) || req.headers["x-forwarded-host"] || req.headers["forwarded"])
    return next(new AppError(403, "LOCAL_PREVIEW_ONLY", "This test server accepts direct local requests only."));
  res.setHeader("Cache-Control", "no-store");
  next();
});
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
  }),
);
app.use(
  cors({
    origin(origin, callback) {
      const allowedOrigins = env.CLIENT_ORIGIN.split(",").map((value) => value.trim());
      if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
      logger.warn(
        { event: "cors_origin_rejected", origin: origin.slice(0, 240) },
        "CORS rejected an unconfigured browser origin",
      );
      return callback(
        new AppError(
          403,
          "CORS_ORIGIN_REJECTED",
          "This browser origin is not allowed to access GETFIT4U.",
        ),
      );
    },
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
  ensureDatabase,
  razorpayWebhook,
);

app.get("/api/v1/webhooks/whatsapp", whatsappWebhookChallenge);
app.post(
  "/api/v1/webhooks/whatsapp",
  express.raw({ type: "application/json", limit: "512kb" }),
  ensureDatabase,
  whatsappWebhook,
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
app.use("/api/v1", ensureDatabase, apiRoutes);
app.use(notFound);
app.use(errorHandler);

export default app;
