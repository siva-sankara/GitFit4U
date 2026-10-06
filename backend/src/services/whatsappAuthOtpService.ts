import { env } from "../config/env.js";
import {
  WhatsAppProvider,
  WhatsAppProviderError,
} from "../integrations/messaging/whatsappProvider.js";
import { AppError } from "../utils/AppError.js";
import { normalizeWhatsAppRecipient } from "./whatsappConnectionService.js";

const provider = new WhatsAppProvider();

function configuration() {
  if (env.WHATSAPP_MODE !== "live")
    throw new AppError(
      503,
      "WHATSAPP_AUTH_NOT_LIVE",
      "WhatsApp verification is unavailable because WHATSAPP_MODE is not set to live.",
    );
  const required = {
    WHATSAPP_ACCESS_TOKEN: env.WHATSAPP_ACCESS_TOKEN,
    WHATSAPP_PHONE_NUMBER_ID: env.WHATSAPP_PHONE_NUMBER_ID,
    WHATSAPP_WABA_ID: env.WHATSAPP_WABA_ID,
    WHATSAPP_AUTH_TEMPLATE_NAME: env.WHATSAPP_AUTH_TEMPLATE_NAME,
  };
  const missing = Object.entries(required).find(([, value]) => !value)?.[0];
  if (missing)
    throw new AppError(
      503,
      "WHATSAPP_AUTH_NOT_CONFIGURED",
      `WhatsApp verification is unavailable because ${missing} is not configured.`,
      { missingVariable: missing },
    );
  return {
    token: required.WHATSAPP_ACCESS_TOKEN!,
    phoneNumberId: required.WHATSAPP_PHONE_NUMBER_ID!,
    wabaId: required.WHATSAPP_WABA_ID!,
    template: required.WHATSAPP_AUTH_TEMPLATE_NAME!,
    language: env.WHATSAPP_AUTH_TEMPLATE_LANGUAGE,
  };
}

function providerFailure(error: unknown): AppError {
  if (!(error instanceof WhatsAppProviderError))
    return new AppError(
      502,
      "WHATSAPP_OTP_PROVIDER_FAILED",
      "Meta could not submit the WhatsApp verification message. Try again later.",
    );
  const details = error.providerCode ? { providerCode: error.providerCode } : undefined;
  switch (error.category) {
    case "CONFIGURATION_MISSING":
    case "TOKEN_OR_PERMISSION_INVALID":
      return new AppError(
        503,
        "WHATSAPP_AUTH_CREDENTIALS_INVALID",
        "The GETFIT4U WhatsApp sender credentials or permissions are invalid.",
        details,
      );
    case "SENDER_DISCONNECTED":
      return new AppError(
        503,
        "WHATSAPP_AUTH_SENDER_NOT_READY",
        "The GETFIT4U WhatsApp sender is not connected and eligible to send messages.",
        details,
      );
    case "TEMPLATE_UNAVAILABLE":
      return new AppError(
        503,
        "WHATSAPP_AUTH_TEMPLATE_UNAVAILABLE",
        "The configured WhatsApp authentication template is unavailable or not approved.",
        details,
      );
    case "LANGUAGE_OR_PARAMETER_MISMATCH":
      return new AppError(
        503,
        "WHATSAPP_AUTH_TEMPLATE_INVALID",
        "The configured authentication template language or Copy Code parameters do not match Meta.",
        details,
      );
    case "RATE_OR_BUDGET_LIMIT":
      return new AppError(
        429,
        "WHATSAPP_PROVIDER_RATE_LIMITED",
        "Meta temporarily rate-limited verification messages. Try again later.",
        details,
      );
    case "UNKNOWN_OUTCOME":
      return new AppError(
        502,
        "WHATSAPP_OTP_SUBMISSION_UNKNOWN",
        "Meta did not confirm whether the verification message was submitted. Wait before requesting another code.",
        details,
      );
    default:
      return new AppError(
        502,
        "WHATSAPP_OTP_DELIVERY_FAILED",
        "Meta rejected the WhatsApp verification message. Check the number and try again.",
        details,
      );
  }
}

export async function sendWhatsAppAuthenticationOtp(phone: string, code: string) {
  const config = configuration();
  try {
    const [templates, phones] = await Promise.all([
      provider.listTemplates(config.token, config.wabaId),
      provider.listPhoneNumbers(config.token, config.wabaId),
    ]);
    const template = templates.find(
      (entry) =>
        String(entry.name) === config.template &&
        String(entry.language) === config.language,
    );
    if (!template)
      throw new AppError(
        503,
        "WHATSAPP_AUTH_TEMPLATE_NOT_FOUND",
        `Meta did not return ${config.template} (${config.language}) for the platform WhatsApp Business Account.`,
      );
    if (String(template.category).toUpperCase() !== "AUTHENTICATION")
      throw new AppError(
        503,
        "WHATSAPP_AUTH_TEMPLATE_CATEGORY_INVALID",
        "The configured Meta template must use the AUTHENTICATION category.",
      );
    if (String(template.status).toUpperCase() !== "APPROVED")
      throw new AppError(
        503,
        "WHATSAPP_AUTH_TEMPLATE_NOT_APPROVED",
        `The configured Meta authentication template is ${String(template.status || "not approved").toLowerCase()}.`,
      );
    const components = Array.isArray(template.components)
      ? template.components
      : [];
    const footer = components.find(
      (entry: any) => String(entry?.type).toUpperCase() === "FOOTER",
    );
    if (Number(footer?.code_expiration_minutes) !== 5)
      throw new AppError(
        503,
        "WHATSAPP_AUTH_TEMPLATE_EXPIRY_MISMATCH",
        "The Meta authentication template must display a five-minute code expiry to match the backend challenge.",
      );
    const buttons = components.find(
      (entry: any) => String(entry?.type).toUpperCase() === "BUTTONS",
    );
    const copyCodeButton = buttons?.buttons?.[0];
    const hasCopyCode =
      String(copyCodeButton?.type).toUpperCase() === "OTP" &&
      String(copyCodeButton?.otp_type).toUpperCase() === "COPY_CODE";
    if (!hasCopyCode)
      throw new AppError(
        503,
        "WHATSAPP_AUTH_TEMPLATE_BUTTON_INVALID",
        "The Meta authentication template must have an OTP Copy Code button at index 0.",
      );
    const sender = phones.find((entry) => String(entry.id) === config.phoneNumberId);
    if (!sender)
      throw new AppError(
        503,
        "WHATSAPP_AUTH_SENDER_NOT_FOUND",
        "The configured platform phone-number ID does not belong to the configured WhatsApp Business Account.",
      );
    const senderStatus = String(
      sender.status || sender.code_verification_status || "UNKNOWN",
    ).toUpperCase();
    if (senderStatus !== "CONNECTED")
      throw new AppError(
        503,
        "WHATSAPP_AUTH_SENDER_NOT_READY",
        `The GETFIT4U WhatsApp sender is ${senderStatus.toLowerCase()} instead of connected.`,
      );
    return await provider.sendAuthenticationCode({
      token: config.token,
      phoneNumberId: config.phoneNumberId,
      to: normalizeWhatsAppRecipient(phone),
      template: config.template,
      language: config.language,
      code,
    });
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw providerFailure(error);
  }
}
