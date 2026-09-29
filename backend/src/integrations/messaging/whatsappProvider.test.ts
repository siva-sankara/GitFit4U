import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../config/env.js", () => ({
  env: {
    WHATSAPP_API_VERSION: "v26.0",
    WHATSAPP_APP_ID: "1234567890123456",
    WHATSAPP_APP_SECRET: "test-app-secret",
    WHATSAPP_DEFAULT_LANGUAGE: "en_US",
  },
}));

import { WhatsAppProvider } from "./whatsappProvider.js";

describe("WhatsAppProvider Embedded Signup exchange", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sends Meta's required explicit empty redirect_uri for the JavaScript SDK flow", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ access_token: "provider-token", expires_in: 3600 }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await new WhatsAppProvider().exchangeEmbeddedSignupCode("one-time-code");

    expect(result).toEqual({ accessToken: "provider-token", expiresIn: 3600 });
    const requestUrl = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(requestUrl.pathname).toBe("/v26.0/oauth/access_token");
    expect(requestUrl.searchParams.has("redirect_uri")).toBe(true);
    expect(requestUrl.searchParams.get("redirect_uri")).toBe("");
  });
});
