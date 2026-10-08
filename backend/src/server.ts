import { startPushDelivery } from "./services/notificationService.js";
import { app } from "./app.js";
import { connectDatabase, disconnectDatabase } from "./config/db.js";
import { env } from "./config/env.js";
import { logger } from "./config/logger.js";
import { createServer } from "node:http";
import { createRealtimeGateway } from "./sockets/gateway.js";
import { startMaintenance } from "./services/maintenanceService.js";

async function start() {
  await connectDatabase();
  const stopMaintenance = startMaintenance();
  const server = createServer(app);
  const io = createRealtimeGateway(server);
  app.set("io", io);
  const stopPush = startPushDelivery(io);
  server.listen(env.PORT, env.OTP_MODE === "development_preview" ? "127.0.0.1" : "0.0.0.0", () => {
    logger.info(
      { port: env.PORT, environment: env.NODE_ENV },
      "GETFIT4U API started",
    );
  });

  async function shutdown(signal: string) {
    logger.info({ signal }, "shutting down");
    stopMaintenance();
    stopPush();
    io.close();
    server.close(async () => {
      await disconnectDatabase();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  }

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

start().catch((error) => {
  logger.fatal({ err: error }, "failed to start API");
  process.exit(1);
});
