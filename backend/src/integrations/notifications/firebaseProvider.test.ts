import { beforeEach, afterEach, expect, it, vi } from "vitest";
vi.mock("../../config/env.js", () => ({
  env: {
    FIREBASE_PROJECT_ID: "test-project",
    FIREBASE_CLIENT_EMAIL: "test@example.test",
    FIREBASE_PRIVATE_KEY: "test-key",
    CLIENT_ORIGIN: "https://gym.example.test,http://localhost:5173",
  },
}));
vi.mock("google-auth-library", () => ({
  GoogleAuth: class {
    getAccessToken = async () => "test-access-token";
  },
}));
import { FirebaseProvider, notificationLink } from "./firebaseProvider.js";
const send = vi.fn();
beforeEach(() => {
  vi.stubGlobal("fetch", send);
  send.mockReset();
});
afterEach(() => vi.unstubAllGlobals());
it("uses the HTTP v1 webpush link and a local navigation path", async () => {
  send.mockResolvedValue(
    new Response(JSON.stringify({ name: "provider-id" }), { status: 200 }),
  );
  const result = await new FirebaseProvider().send({
    token: "device",
    title: "Membership active",
    body: "Ready",
    data: { notificationId: "id", navigationPath: "/app/subscriptions" },
  });
  const body = JSON.parse(send.mock.calls[0][1].body);
  expect(body.message.webpush.fcm_options.link).toBe(
    "https://gym.example.test/app/subscriptions",
  );
  expect(body.message.data.navigationPath).toBe("/app/subscriptions");
  expect(result.providerMessageId).toBe("provider-id");
});
it("rejects external notification click destinations", () => {
  expect(notificationLink("https://evil.test")).toBe(
    "https://gym.example.test/notifications",
  );
  expect(notificationLink("//evil.test/path")).toBe(
    "https://gym.example.test/notifications",
  );
});
it("classifies invalid tokens without leaking provider responses", async () => {
  send.mockResolvedValue(
    new Response(
      JSON.stringify({
        error: {
          details: [
            {
              "@type": "type.googleapis.com/google.firebase.fcm.v1.FcmError",
              errorCode: "UNREGISTERED",
            },
          ],
        },
      }),
      { status: 404 },
    ),
  );
  await expect(
    new FirebaseProvider().send({
      token: "secret",
      title: "Test",
      body: "Test",
    }),
  ).rejects.toMatchObject({ code: "UNREGISTERED", retryable: false });
});
it("retries quota and transient provider failures", async () => {
  send.mockResolvedValue(
    new Response(JSON.stringify({ error: { status: "RESOURCE_EXHAUSTED" } }), {
      status: 429,
    }),
  );
  await expect(
    new FirebaseProvider().send({
      token: "device",
      title: "Test",
      body: "Test",
    }),
  ).rejects.toMatchObject({ retryable: true });
});
