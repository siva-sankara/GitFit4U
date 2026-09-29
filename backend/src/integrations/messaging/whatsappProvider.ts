import { createHmac } from "node:crypto";
import { env } from "../../config/env.js";

export type WhatsAppProviderErrorCategory =
  | "CONFIGURATION_MISSING"
  | "TOKEN_OR_PERMISSION_INVALID"
  | "SENDER_DISCONNECTED"
  | "TEMPLATE_UNAVAILABLE"
  | "LANGUAGE_OR_PARAMETER_MISMATCH"
  | "RATE_OR_BUDGET_LIMIT"
  | "RECIPIENT_OR_PROVIDER_FAILURE"
  | "UNKNOWN_OUTCOME";

export class WhatsAppProviderError extends Error {
  constructor(
    public category: WhatsAppProviderErrorCategory,
    message: string,
    public retryable = false,
    public providerCode?: string,
    public uncertain = false,
  ) {
    super(message);
    this.name = "WhatsAppProviderError";
  }
}

type GraphResponse = Record<string, any>;
type SendResult = { providerMessageId: string; raw: GraphResponse };

function graphUrl(path: string) {
  return `https://graph.facebook.com/${env.WHATSAPP_API_VERSION}/${path.replace(/^\//, "")}`;
}

function appSecretProof(token: string) {
  if (!env.WHATSAPP_APP_SECRET) return undefined;
  return createHmac("sha256", env.WHATSAPP_APP_SECRET).update(token).digest("hex");
}

function providerError(
  status: number,
  body: GraphResponse,
  uncertain = false,
) {
  const code = String(body?.error?.code || body?.error?.error_subcode || status);
  const message = String(body?.error?.message || "WhatsApp provider request failed.").slice(0, 500);
  const category: WhatsAppProviderErrorCategory =
    status === 401 || status === 403 || [10, 190, 200].includes(Number(code))
      ? "TOKEN_OR_PERMISSION_INVALID"
      : [130429, 131048, 4, 17, 613].includes(Number(code))
        ? "RATE_OR_BUDGET_LIMIT"
        : [132000, 132001].includes(Number(code))
          ? "TEMPLATE_UNAVAILABLE"
          : [132012, 132015].includes(Number(code))
            ? "LANGUAGE_OR_PARAMETER_MISMATCH"
            : uncertain
              ? "UNKNOWN_OUTCOME"
              : "RECIPIENT_OR_PROVIDER_FAILURE";
  const retryable = uncertain || status >= 500 || status === 429 || [4, 17, 613, 130429].includes(Number(code));
  return new WhatsAppProviderError(category, message, retryable, code, uncertain);
}

async function graphRequest(
  path: string,
  options: {
    method?: "GET" | "POST" | "DELETE";
    token?: string;
    body?: Record<string, unknown>;
    query?: Record<string, string | undefined>;
    sendingMessage?: boolean;
  } = {},
) {
  const url = new URL(graphUrl(path));
  for (const [key, value] of Object.entries(options.query || {}))
    if (value !== undefined) url.searchParams.set(key, value);
  if (options.token) {
    const proof = appSecretProof(options.token);
    if (proof) url.searchParams.set("appsecret_proof", proof);
  }
  let response: Response;
  try {
    response = await fetch(url, {
      method: options.method || "GET",
      headers: {
        ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
        ...(options.body ? { "content-type": "application/json" } : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    const uncertain = options.sendingMessage === true;
    throw new WhatsAppProviderError(
      uncertain ? "UNKNOWN_OUTCOME" : "RECIPIENT_OR_PROVIDER_FAILURE",
      uncertain
        ? "The provider response was not received; delivery outcome is unknown."
        : "The WhatsApp provider is temporarily unreachable.",
      true,
      undefined,
      uncertain,
    );
  }
  const body = (await response.json().catch(() => ({}))) as GraphResponse;
  if (!response.ok) throw providerError(response.status, body);
  return body;
}

export class WhatsAppProvider {
  async exchangeEmbeddedSignupCode(code: string) {
    if (!env.WHATSAPP_APP_ID || !env.WHATSAPP_APP_SECRET)
      throw new WhatsAppProviderError(
        "CONFIGURATION_MISSING",
        "Meta Embedded Signup is not configured.",
      );
    const result = await graphRequest("oauth/access_token", {
      query: {
        client_id: env.WHATSAPP_APP_ID,
        client_secret: env.WHATSAPP_APP_SECRET,
        code,
        // Meta's JavaScript SDK Embedded Signup flow expects this parameter to
        // be present during code exchange even though its value is empty. This
        // matches Meta's Tech Provider sample and is not browser-controlled.
        redirect_uri: "http://localhost:5001/api/v1/whatsapp/onboarding/complete",
      },
    });
    if (!result.access_token)
      throw new WhatsAppProviderError(
        "TOKEN_OR_PERMISSION_INVALID",
        "Meta did not return an access token.",
      );
    return {
      accessToken: String(result.access_token),
      expiresIn: Number(result.expires_in || 0) || undefined,
    };
  }

  async listPhoneNumbers(token: string, wabaId: string) {
    const result = await graphRequest(`${encodeURIComponent(wabaId)}/phone_numbers`, {
      token,
      query: {
        fields:
          "id,display_phone_number,verified_name,quality_rating,status,code_verification_status,platform_type,throughput",
        limit: "100",
      },
    });
    return (result.data || []) as Array<Record<string, unknown>>;
  }

  async inspectWaba(token: string, wabaId: string) {
    return graphRequest(encodeURIComponent(wabaId), {
      token,
      query: { fields: "id,name,currency,timezone_id,message_template_namespace" },
    });
  }

  async inspectToken(token: string) {
    if (!env.WHATSAPP_APP_ID || !env.WHATSAPP_APP_SECRET)
      throw new WhatsAppProviderError(
        "CONFIGURATION_MISSING",
        "Meta application credentials are not configured.",
      );
    const result = await graphRequest("debug_token", {
      query: {
        input_token: token,
        access_token: `${env.WHATSAPP_APP_ID}|${env.WHATSAPP_APP_SECRET}`,
      },
    });
    const data = result.data || {};
    const scopes = new Set<string>([
      ...(Array.isArray(data.scopes) ? data.scopes.map(String) : []),
      ...(Array.isArray(data.granular_scopes)
        ? data.granular_scopes.map((entry: any) => String(entry.scope || ""))
        : []),
    ]);
    return {
      valid: data.is_valid === true,
      appId: String(data.app_id || ""),
      scopes: [...scopes].filter(Boolean),
      expiresAt: Number(data.expires_at || 0) || undefined,
    };
  }

  async subscribeWaba(token: string, wabaId: string) {
    return graphRequest(`${encodeURIComponent(wabaId)}/subscribed_apps`, {
      method: "POST",
      token,
    });
  }

  async unsubscribeWaba(token: string, wabaId: string) {
    return graphRequest(`${encodeURIComponent(wabaId)}/subscribed_apps`, {
      method: "DELETE",
      token,
    });
  }

  async listTemplates(token: string, wabaId: string) {
    const result = await graphRequest(`${encodeURIComponent(wabaId)}/message_templates`, {
      token,
      query: {
        fields: "id,name,language,category,status,components,quality_score",
        limit: "250",
      },
    });
    return (result.data || []) as Array<Record<string, unknown>>;
  }

  async sendTemplate(input: {
    token: string;
    phoneNumberId: string;
    to: string;
    template: string;
    language?: string;
    components?: unknown[];
  }): Promise<SendResult> {
    const raw = await graphRequest(`${encodeURIComponent(input.phoneNumberId)}/messages`, {
      method: "POST",
      token: input.token,
      sendingMessage: true,
      body: {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: input.to,
        type: "template",
        template: {
          name: input.template,
          language: { code: input.language || env.WHATSAPP_DEFAULT_LANGUAGE },
          components: input.components || [],
        },
      },
    });
    const providerMessageId = raw.messages?.[0]?.id;
    if (!providerMessageId)
      throw new WhatsAppProviderError(
        "UNKNOWN_OUTCOME",
        "Meta accepted the request without returning a message identifier.",
        false,
        undefined,
        true,
      );
    return { providerMessageId: String(providerMessageId), raw };
  }

  async sendText(input: {
    token: string;
    phoneNumberId: string;
    to: string;
    text: string;
  }): Promise<SendResult> {
    const raw = await graphRequest(`${encodeURIComponent(input.phoneNumberId)}/messages`, {
      method: "POST",
      token: input.token,
      sendingMessage: true,
      body: {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: input.to,
        type: "text",
        text: { body: input.text, preview_url: false },
      },
    });
    const providerMessageId = raw.messages?.[0]?.id;
    if (!providerMessageId)
      throw new WhatsAppProviderError(
        "UNKNOWN_OUTCOME",
        "Meta accepted the request without returning a message identifier.",
        false,
        undefined,
        true,
      );
    return { providerMessageId: String(providerMessageId), raw };
  }
}
