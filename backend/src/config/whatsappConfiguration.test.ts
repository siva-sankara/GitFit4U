import { describe, expect, it } from "vitest";
import { parseEnvironment } from "./env.js";
const complete = {
  NODE_ENV: "test", WHATSAPP_ENABLED: "true", WHATSAPP_APP_ID: "test-app", WHATSAPP_APP_SECRET: "test-secret",
  WHATSAPP_ACCESS_TOKEN: "test-token", WHATSAPP_PHONE_NUMBER_ID: "123456789", WHATSAPP_BUSINESS_ACCOUNT_ID: "987654321",
  WHATSAPP_VERIFY_TOKEN: "test-verify", WHATSAPP_GRAPH_API_VERSION: "v26.0", WHATSAPP_CREDENTIAL_ENCRYPTION_KEY: "x".repeat(48),
};
describe("WhatsApp opt-in configuration", () => {
  it("starts disabled without credentials, including an old live mode overridden by the flag", () => {
    expect(parseEnvironment({ NODE_ENV: "test", WHATSAPP_ENABLED: "false", WHATSAPP_MODE: "live" })).toMatchObject({ WHATSAPP_ENABLED: false, WHATSAPP_MODE: "disabled", WHATSAPP_AUTH_OTP_ENABLED: false });
  });
  it("maps new aliases to the existing provider without requiring Embedded Signup", () => {
    expect(parseEnvironment(complete)).toMatchObject({ WHATSAPP_MODE: "live", WHATSAPP_WABA_ID: "987654321", WHATSAPP_API_VERSION: "v26.0", WHATSAPP_AUTH_OTP_ENABLED: false });
  });
  it.each(["WHATSAPP_ACCESS_TOKEN", "WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_BUSINESS_ACCOUNT_ID", "WHATSAPP_GRAPH_API_VERSION", "WHATSAPP_APP_SECRET", "WHATSAPP_VERIFY_TOKEN", "WHATSAPP_CREDENTIAL_ENCRYPTION_KEY"])("rejects enabled configuration without %s", key => {
    expect(() => parseEnvironment({ ...complete, [key]: "" })).toThrow();
  });
  it("requires an authentication template only when its own flag is enabled", () => {
    expect(() => parseEnvironment({ ...complete, WHATSAPP_AUTH_OTP_ENABLED: "true" })).toThrow(/AUTH_OTP/);
    expect(parseEnvironment({ ...complete, WHATSAPP_AUTH_OTP_ENABLED: "true", WHATSAPP_TEMPLATE_AUTH_OTP: "getfit4u_otp" })).toMatchObject({ WHATSAPP_AUTH_OTP_ENABLED: true, WHATSAPP_AUTH_TEMPLATE_NAME: "getfit4u_otp" });
  });
  it("preserves an existing live deployment and its configured authentication template", () => {
    const legacy = { ...complete, WHATSAPP_ENABLED: undefined, WHATSAPP_MODE: "live", WHATSAPP_AUTH_TEMPLATE_NAME: "already_approved" };
    expect(parseEnvironment(legacy)).toMatchObject({ WHATSAPP_CONFIGURATION_LEGACY: true, WHATSAPP_AUTH_OTP_ENABLED: true });
  });
});
