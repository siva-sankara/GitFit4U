import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "../../config/env.js";
import {
  resetMicrosoftGraphOtpTokenCache,
  sendMicrosoftGraphOtpEmail,
} from "./microsoftGraphOtpProvider.js";

const original = {
  enabled: env.AUTH_OTP_DUAL_DELIVERY_ENABLED,
  tenant: env.M365_TENANT_ID,
  client: env.M365_CLIENT_ID,
  secret: env.M365_CLIENT_SECRET,
  mailbox: env.M365_SENDER_MAILBOX,
  from: env.M365_FROM_EMAIL,
  name: env.M365_FROM_NAME,
  replyTo: env.M365_REPLY_TO,
};

function response(status: number, body?: unknown, headers: Record<string, string> = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
    json: vi.fn().mockResolvedValue(body),
  } as unknown as Response;
}

beforeEach(() => {
  resetMicrosoftGraphOtpTokenCache();
  env.AUTH_OTP_DUAL_DELIVERY_ENABLED = true;
  env.M365_TENANT_ID = "tenant-id";
  env.M365_CLIENT_ID = "client-id";
  env.M365_CLIENT_SECRET = "client-secret-value";
  env.M365_SENDER_MAILBOX = "support@getfit4u.in";
  env.M365_FROM_EMAIL = "support@getfit4u.in";
  env.M365_FROM_NAME = "GETFIT4U";
  env.M365_REPLY_TO = "support@getfit4u.in";
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetMicrosoftGraphOtpTokenCache();
  env.AUTH_OTP_DUAL_DELIVERY_ENABLED = original.enabled;
  env.M365_TENANT_ID = original.tenant;
  env.M365_CLIENT_ID = original.client;
  env.M365_CLIENT_SECRET = original.secret;
  env.M365_SENDER_MAILBOX = original.mailbox;
  env.M365_FROM_EMAIL = original.from;
  env.M365_FROM_NAME = original.name;
  env.M365_REPLY_TO = original.replyTo;
});

describe("Microsoft Graph authentication OTP email", () => {
  it("uses client credentials and the fixed support mailbox, and accepts an empty 202 response", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        response(200, { access_token: "short-lived-token", expires_in: 3600 }),
      )
      .mockResolvedValueOnce(response(202, undefined, { "request-id": "graph-request" }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      sendMicrosoftGraphOtpEmail({
        to: "member@example.com",
        subject: "Your GETFIT4U login verification code",
        html: "<p>123456</p>",
      }),
    ).resolves.toEqual({ submissionReference: "graph-request" });

    const tokenUrl = String(fetchMock.mock.calls[0][0]);
    const tokenRequest = fetchMock.mock.calls[0][1] as RequestInit;
    expect(tokenUrl).toBe(
      "https://login.microsoftonline.com/tenant-id/oauth2/v2.0/token",
    );
    expect(String(tokenRequest.body)).toContain(
      "scope=https%3A%2F%2Fgraph.microsoft.com%2F.default",
    );
    expect(String(tokenRequest.body)).toContain("grant_type=client_credentials");

    const sendUrl = String(fetchMock.mock.calls[1][0]);
    const sendRequest = fetchMock.mock.calls[1][1] as RequestInit;
    const payload = JSON.parse(String(sendRequest.body));
    expect(sendUrl).toBe(
      "https://graph.microsoft.com/v1.0/users/support%40getfit4u.in/sendMail",
    );
    expect(payload).toMatchObject({
      message: {
        from: { emailAddress: { address: "support@getfit4u.in", name: "GETFIT4U" } },
        toRecipients: [{ emailAddress: { address: "member@example.com" } }],
      },
      saveToSentItems: false,
    });
    expect(JSON.stringify(payload)).not.toContain("client-secret-value");
  });

  it("shares one cached token acquisition across concurrent sends", async () => {
    let tokenRequests = 0;
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (String(url).includes("oauth2/v2.0/token")) {
        tokenRequests += 1;
        return response(200, { access_token: "cached-token", expires_in: 3600 });
      }
      return response(202);
    });
    vi.stubGlobal("fetch", fetchMock);
    await Promise.all([
      sendMicrosoftGraphOtpEmail({ to: "one@example.com", subject: "One", html: "one" }),
      sendMicrosoftGraphOtpEmail({ to: "two@example.com", subject: "Two", html: "two" }),
    ]);
    expect(tokenRequests).toBe(1);
  });

  it("reports expired or invalid client credentials without exposing provider bodies", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(401)));
    await expect(
      sendMicrosoftGraphOtpEmail({ to: "member@example.com", subject: "Code", html: "code" }),
    ).rejects.toMatchObject({ code: "M365_CLIENT_CREDENTIAL_INVALID", statusCode: 503 });
  });

  it("reports mailbox authorization and throttling separately", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(200, { access_token: "token", expires_in: 3600 }))
      .mockResolvedValueOnce(response(403));
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      sendMicrosoftGraphOtpEmail({ to: "member@example.com", subject: "Code", html: "code" }),
    ).rejects.toMatchObject({ code: "M365_MAIL_SEND_FORBIDDEN" });

    resetMicrosoftGraphOtpTokenCache();
    fetchMock
      .mockResolvedValueOnce(response(200, { access_token: "token-2", expires_in: 3600 }))
      .mockResolvedValueOnce(response(429, undefined, { "retry-after": "7" }));
    await expect(
      sendMicrosoftGraphOtpEmail({ to: "member@example.com", subject: "Code", html: "code" }),
    ).rejects.toMatchObject({
      code: "M365_RATE_LIMITED",
      details: { retryAfterMs: 7000 },
    });
  });
});
