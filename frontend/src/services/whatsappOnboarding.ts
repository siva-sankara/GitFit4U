export type WhatsAppConnectionMode = "COEXISTENCE" | "STANDARD";

export type WhatsAppSignup = {
  onboardingSessionId: string;
  state: string;
  connectionMode: WhatsAppConnectionMode;
  appId: string;
  configId: string;
  graphApiVersion: string;
  embeddedSignupVersion: "v4";
  featureType?: "whatsapp_business_app_onboarding";
  diagnosticReference: string;
};

const metaSignupOrigins = new Set([
  "https://www.facebook.com",
  "https://web.facebook.com",
  "https://business.facebook.com",
]);

export function embeddedSignupOptions(signup: WhatsAppSignup) {
  return {
    config_id: signup.configId,
    response_type: "code",
    override_default_response_type: true,
    state: signup.state,
    extras: {
      setup: {},
      ...(signup.featureType ? { featureType: signup.featureType } : {}),
    },
  };
}

export function parseEmbeddedSignupMessage(event: Pick<MessageEvent, "origin" | "data">) {
  if (!metaSignupOrigins.has(event.origin)) return null;
  let payload: any = event.data;
  try {
    if (typeof payload === "string") payload = JSON.parse(payload);
  } catch {
    return null;
  }
  if (payload?.type !== "WA_EMBEDDED_SIGNUP") return null;
  const name = String(payload.event || "");
  if (["CANCEL", "ERROR"].includes(name))
    return { kind: name as "CANCEL" | "ERROR" };
  if (!["FINISH", "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING"].includes(name))
    return null;
  return {
    kind: "FINISH" as const,
    sessionEvent: {
      event: name,
      version: payload.version,
      data: {
        waba_id: String(payload.data?.waba_id || ""),
        ...(payload.data?.phone_number_id
          ? { phone_number_id: String(payload.data.phone_number_id) }
          : {}),
        ...(typeof payload.data?.history_sharing === "boolean"
          ? { history_sharing: payload.data.history_sharing }
          : {}),
        ...(typeof payload.data?.is_history_sharing_enabled === "boolean"
          ? { is_history_sharing_enabled: payload.data.is_history_sharing_enabled }
          : {}),
      },
    },
  };
}
