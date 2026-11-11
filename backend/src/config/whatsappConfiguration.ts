import { z } from "zod";

// Compatibility names for deployments that predate WHATSAPP_ENABLED. New
// deployments explicitly configure template names; approval is always checked.
export const legacyWhatsAppTemplateNames = {
  WHATSAPP_TEMPLATE_WELCOME: "welcome_msg_template",
  WHATSAPP_TEMPLATE_MEMBERSHIP_RENEWAL: "appointment_reminder",
  WHATSAPP_TEMPLATE_PLATFORM_RENEWAL: "platform_renewal",
  WHATSAPP_TEMPLATE_INVOICE: "gfu_invoice_available",
  WHATSAPP_TEMPLATE_MEMBERSHIP_RENEWED: "gfu_membership_renewed",
  WHATSAPP_TEMPLATE_MEMBER_INVITATION: "gfu_member_invitation",
  WHATSAPP_TEMPLATE_PAYMENT_REMINDER: "gfu_payment_reminder",
  WHATSAPP_TEMPLATE_MEMBER_FOLLOWUP: "gfu_member_followup",
  WHATSAPP_TEMPLATE_CLASS_BOOKED: "gfu_class_booking_confirmed",
  WHATSAPP_TEMPLATE_CLASS_CANCELLED: "gfu_class_cancelled",
  WHATSAPP_TEMPLATE_CLASS_UPDATED: "gfu_class_updated",
  WHATSAPP_TEMPLATE_CLASS_REMINDER: "gfu_class_reminder",
  WHATSAPP_TEMPLATE_ACCOUNT_WELCOME: "gfu_account_welcome",
  WHATSAPP_TEMPLATE_MEMBERSHIP_CREATED: "gfu_membership_created",
  WHATSAPP_TEMPLATE_MEMBERSHIP_FROZEN: "gfu_membership_frozen",
  WHATSAPP_TEMPLATE_MEMBERSHIP_REACTIVATED: "gfu_membership_reactivated",
  WHATSAPP_TEMPLATE_MEMBERSHIP_DEACTIVATED: "gfu_membership_deactivated",
  WHATSAPP_TEMPLATE_MEMBERSHIP_EXPIRED: "gfu_membership_expired",
  WHATSAPP_TEMPLATE_MEMBERSHIP_CANCELLED: "gfu_membership_cancelled",
  WHATSAPP_TEMPLATE_PAYMENT_SUCCESS: "gfu_payment_confirmed",
  WHATSAPP_TEMPLATE_PAYMENT_OFFLINE: "gfu_offline_payment_recorded",
  WHATSAPP_TEMPLATE_PAYMENT_REFUNDED: "gfu_refund_updated",
  WHATSAPP_TEMPLATE_TRAINER_ASSIGNED: "gfu_trainer_assigned",
  WHATSAPP_TEMPLATE_SUPPORT_UPDATED: "gfu_support_updated",
  WHATSAPP_TEMPLATE_GYM_STATUS: "gfu_gym_status_updated",
  WHATSAPP_TEMPLATE_MEMBERSHIP_ACTIVATED: "",
} as const;
export type WhatsAppTemplateKey = keyof typeof legacyWhatsAppTemplateNames;
const templateName = z.preprocess(value => value || undefined, z.string().regex(/^[a-z0-9_]{1,512}$/).optional());
export const whatsappTemplateFields = Object.fromEntries(
  Object.keys(legacyWhatsAppTemplateNames).map(key => [key, templateName]),
) as Record<WhatsAppTemplateKey, typeof templateName>;

export function normalizeWhatsAppEnvironment(input: NodeJS.ProcessEnv) {
  const legacy = input.WHATSAPP_ENABLED === undefined;
  const mode = input.WHATSAPP_ENABLED === "false" ? "disabled"
    : input.WHATSAPP_ENABLED === "true" ? (input.WHATSAPP_MODE === "dry_run" ? "dry_run" : "live")
      : input.WHATSAPP_MODE || "disabled";
  return {
    ...input,
    WHATSAPP_CONFIGURATION_LEGACY: legacy,
    WHATSAPP_ENABLED: input.WHATSAPP_ENABLED ?? (mode === "disabled" ? "false" : "true"),
    WHATSAPP_MODE: mode,
    WHATSAPP_AUTH_OTP_ENABLED: input.WHATSAPP_AUTH_OTP_ENABLED ??
      (legacy && mode === "live" && input.WHATSAPP_AUTH_TEMPLATE_NAME ? "true" : "false"),
    WHATSAPP_WABA_ID: input.WHATSAPP_BUSINESS_ACCOUNT_ID || input.WHATSAPP_WABA_ID,
    WHATSAPP_GRAPH_API_VERSION: input.WHATSAPP_GRAPH_API_VERSION || input.WHATSAPP_API_VERSION,
    WHATSAPP_API_VERSION: input.WHATSAPP_GRAPH_API_VERSION || input.WHATSAPP_API_VERSION,
    WHATSAPP_AUTH_TEMPLATE_NAME: input.WHATSAPP_TEMPLATE_AUTH_OTP || input.WHATSAPP_AUTH_TEMPLATE_NAME,
  };
}
