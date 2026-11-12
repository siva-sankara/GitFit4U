import { connectDatabase, disconnectDatabase } from "../config/db.js";
import { logger } from "../config/logger.js";
import { deliverAuthOtpDeliveries } from "../services/authOtpDeliveryService.js";

let stopping = false;
async function run() {
  await connectDatabase();
  logger.info("GETFIT4U authentication OTP delivery worker started");
  while (!stopping) {
    try {
      const result = await deliverAuthOtpDeliveries(50);
      if (!result.processed)
        await new Promise((resolve) => {
          setTimeout(resolve, 1_000);
        });
    } catch (error) {
      logger.error({ err: error }, "Authentication OTP delivery batch failed");
      await new Promise((resolve) => {
        setTimeout(resolve, 2_000);
      });
    }
  }
  await disconnectDatabase();
}

for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.on(signal, () => {
    stopping = true;
  });

void run().catch((error) => {
  logger.fatal({ err: error }, "Authentication OTP delivery worker stopped");
  process.exit(1);
});
