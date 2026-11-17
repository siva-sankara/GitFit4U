import { expect, it } from "vitest";
import { oauthOriginsMixLocalAndPublic, oauthUrlBlockers, razorpayCallbackPath } from "./razorpayOAuth.js";
it.each(["hhttps://www.getfit4u.in", "http://www.getfit4u.in", "https://user:pass@www.getfit4u.in"])("rejects unsafe callback origin %s", origin => {
  expect(oauthUrlBlockers({ FRONTEND_URL: "https://www.getfit4u.in", RAZORPAY_OAUTH_REDIRECT_URI: origin + razorpayCallbackPath })).not.toEqual([]);
});
it.each(["/", razorpayCallbackPath + "/", razorpayCallbackPath + "?x=1", razorpayCallbackPath + "#x"])("requires the exact callback path: %s", path => {
  expect(oauthUrlBlockers({ FRONTEND_URL: "https://www.getfit4u.in", RAZORPAY_OAUTH_REDIRECT_URI: "https://www.getfit4u.in" + path })).not.toEqual([]);
});
it("allows the local Vite proxy in development but not production", () => {
  const config = { FRONTEND_URL: "http://localhost:5173", RAZORPAY_OAUTH_REDIRECT_URI: "http://localhost:5173" + razorpayCallbackPath };
  expect(oauthUrlBlockers(config)).toEqual([]);
  expect(oauthUrlBlockers({ ...config, NODE_ENV: "production" })).toHaveLength(2);
});
it("supports both same-origin proxy and separately registered backend callbacks", () => {
  for (const origin of ["https://www.getfit4u.in", "https://backend.example.com"])
    expect(oauthUrlBlockers({ NODE_ENV: "production", FRONTEND_URL: "https://www.getfit4u.in", RAZORPAY_OAUTH_REDIRECT_URI: origin + razorpayCallbackPath })).toEqual([]);
});
it.each([
  ["http://localhost:5173", "https://backend.example.com", true],
  ["https://www.getfit4u.in", "http://localhost:5001", true],
  ["http://localhost:5173", "http://127.0.0.1:5001", false],
  ["https://www.getfit4u.in", "https://backend.example.com", false],
])("checks whether %s and %s mix local and public environments", (frontend, callback, expected) => {
  expect(oauthOriginsMixLocalAndPublic(new URL(frontend), new URL(callback))).toBe(expected);
});
