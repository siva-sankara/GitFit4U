import { describe, expect, it } from "vitest";
import { securityHeaders } from "./securityHeaders";
describe("deployment CSP", () => {
  it("permits configured API/socket, private media, payments, Google and Firebase without disabling CSP", () => {
    const headers = securityHeaders({
      VITE_API_URL: "https://gym-api.example/api-base",
      VITE_MEDIA_ORIGINS:
        "https://private-bucket.s3.example https://media.example",
    });
    for (const value of [
      "https://gym-api.example",
      "wss://gym-api.example",
      "https://private-bucket.s3.example",
      "https://checkout.razorpay.com",
      "https://accounts.google.com/gsi/client",
      "https://firebaseinstallations.googleapis.com",
      "https://fcmregistrations.googleapis.com",
      "https://connect.facebook.net",
      "https://www.facebook.com",
      "object-src 'none'",
      "frame-ancestors 'none'",
    ])
      expect(headers).toContain(value);
    expect(headers).not.toContain("unsafe-eval");
    expect(headers).not.toContain("https://*.amazonaws.com");
    expect(headers).not.toContain("api.getfit4u.in");
    expect(headers.match(/img-src ([^;]+)/)?.[1].split(" ")).toContain(
      "https://gym-api.example",
    );
  });
  it("supports same-origin deployments and legacy provider media without allowing arbitrary scripts", () => {
    const headers = securityHeaders();
    expect(headers).toContain("https://*.amazonaws.com");
    expect(headers).toContain("https://res.cloudinary.com");
    expect(headers.match(/media-src ([^;]+)/)?.[1].split(" ")).toContain(
      "https://api.cloudinary.com",
    );
    expect(headers.match(/script-src ([^;]+)/)?.[1].split(" ")).toContain(
      "https://connect.facebook.net",
    );
  });
  it.each([
    "https://secret@example.com",
    "javascript:alert(1)",
    "https://media.example/?token=secret",
    "https://example.com/#injection",
    "https://example.com;script-src",
  ])("rejects unsafe configuration: %s", (value) => {
    expect(() => securityHeaders({ VITE_MEDIA_ORIGINS: value })).toThrow();
  });
});
