import { env } from "../config/env.js";
import { WhatsAppProvider, WhatsAppProviderError } from "../integrations/messaging/whatsappProvider.js";
// Read-only: never generates a challenge, sends a message or prints credentials.
const provider = new WhatsAppProvider();
const token = env.WHATSAPP_ACCESS_TOKEN, waba = env.WHATSAPP_WABA_ID;
if (!token || !waba) {
  console.log(JSON.stringify({ ready: false, reason: "Platform sender credentials are missing" }));
  process.exitCode = 1;
} else {
  const results = await Promise.allSettled([provider.listTemplates(token, waba), provider.listPhoneNumbers(token, waba)]);
  const safeFailure = (error: unknown) => error instanceof WhatsAppProviderError ? { category: error.category, code: error.providerCode } : { category: "READ_FAILED" };
  const templates = results[0], phones = results[1];
  console.log(JSON.stringify({
    mode: env.WHATSAPP_MODE,
    authenticationTemplateConfigured: Boolean(env.WHATSAPP_AUTH_TEMPLATE_NAME),
    templates: templates.status === "fulfilled" ? templates.value.filter(row => row.category === "AUTHENTICATION").map(row => ({
      name: row.name, language: row.language, status: row.status, components: row.components,
    })) : safeFailure(templates.reason),
    sender: phones.status === "fulfilled" ? phones.value.filter(row => String(row.id) === env.WHATSAPP_PHONE_NUMBER_ID).map(row => ({
      status: row.status, verification: row.code_verification_status, quality: row.quality_rating, platform: row.platform_type,
    })) : safeFailure(phones.reason),
  }, null, 2));
  if (results.some(result => result.status === "rejected")) process.exitCode = 1;
}
