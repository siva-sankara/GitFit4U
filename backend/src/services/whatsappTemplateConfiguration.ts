import { env } from "../config/env.js";
import { legacyWhatsAppTemplateNames, type WhatsAppTemplateKey } from "../config/whatsappConfiguration.js";

export function configuredWhatsAppTemplate(key: WhatsAppTemplateKey) {
  return env[key] || (env.WHATSAPP_CONFIGURATION_LEGACY !== false ? legacyWhatsAppTemplateNames[key] || undefined : undefined);
}

export function legacyWelcomeContract(template?: string) {
  return template === legacyWhatsAppTemplateNames.WHATSAPP_TEMPLATE_WELCOME;
}
