import { connectDatabase, disconnectDatabase } from "../config/db.js";
import { logger } from "../config/logger.js";
import { env } from "../config/env.js";
import { processWhatsAppCampaignBatch, processWhatsAppOutbox } from "../services/whatsappDeliveryService.js";
import { processWhatsAppWebhooks } from "../services/whatsappWebhookService.js";

let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    stopping = true;
  });

const wait = (milliseconds: number) =>
  new Promise((resolve) => { setTimeout(resolve, milliseconds); });

try {
  await connectDatabase();
  logger.info({ enabled: env.WHATSAPP_WORKER_ENABLED }, "WhatsApp durable worker started");
  while (!stopping) {
    if (!env.WHATSAPP_WORKER_ENABLED) {
      await wait(10_000);
      continue;
    }
    try {
      const webhooks = await processWhatsAppWebhooks(50);
      const campaign = await processWhatsAppCampaignBatch();
      const deliveries = await processWhatsAppOutbox(25);
      if (!webhooks && !campaign && !deliveries) await wait(1_500);
    } catch (error) {
      logger.error({ err: error }, "WhatsApp worker cycle failed");
      await wait(5_000);
    }
  }
} catch (error) {
  logger.fatal({ err: error }, "WhatsApp worker could not start");
  process.exitCode = 1;
} finally {
  await disconnectDatabase();
  logger.info("WhatsApp durable worker stopped");
}
