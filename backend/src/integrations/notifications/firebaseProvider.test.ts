import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  initialize: vi.fn(),
  cert: vi.fn(),
  apps: vi.fn(),
}));
vi.mock("../../config/env.js", () => ({
  env: {
    FIREBASE_PROJECT_ID: "test-project",
    FIREBASE_CLIENT_EMAIL: "test@example.test",
    FIREBASE_PRIVATE_KEY: "test-key",
    CLIENT_ORIGIN: "https://gym.example.test,http://localhost:5173",
  },
}));
vi.mock("firebase-admin/app", () => ({
  cert: mocks.cert,
  getApps: mocks.apps,
  initializeApp: mocks.initialize,
}));
vi.mock("firebase-admin/messaging", () => ({
  getMessaging: () => ({ send: mocks.send }),
}));
import { FirebaseProvider, notificationLink } from "./firebaseProvider.js";
beforeEach(() => {
  vi.resetAllMocks();
  mocks.apps.mockReturnValue([]);
  mocks.send.mockResolvedValue("provider-id");
});
it("uses Firebase Admin SDK with safe local deep links and stable notification tags", async () => {
  const result = await new FirebaseProvider().send({
    token: "device",
    title: "Membership active",
    body: "Ready",
    data: { notificationId: "notice", navigationPath: "/messages/thread-id" },
  });
  expect(mocks.cert).toHaveBeenCalledWith({
    projectId: "test-project",
    clientEmail: "test@example.test",
    privateKey: "test-key",
  });
  expect(mocks.send.mock.calls[0][0]).toMatchObject({
    data: { navigationPath: "/messages/thread-id" },
    webpush: {
      fcmOptions: { link: "https://gym.example.test/messages/thread-id" },
      notification: { tag: "notice", renotify: false },
    },
  });
  expect(result.providerMessageId).toBe("provider-id");
});
it.each(["https://evil.test", "//evil.test/path", "/\\evil.test/path"])(
  "rejects an external click target %s",
  (path) =>
    expect(notificationLink(path)).toBe(
      "https://gym.example.test/notifications",
    ),
);
it.each([
  "messaging/registration-token-not-registered",
  "messaging/invalid-registration-token",
])("deactivates invalid SDK tokens %s without exposing them", async (code) => {
  mocks.send.mockRejectedValue({ code, message: "sensitive-token" });
  await expect(
    new FirebaseProvider().send({
      token: "secret",
      title: "Test",
      body: "Test",
    }),
  ).rejects.toMatchObject({
    code: "UNREGISTERED",
    retryable: false,
    message: "Push notification delivery failed.",
  });
});
it.each([
  "messaging/quota-exceeded",
  "messaging/server-unavailable",
  "app/network-error",
])("retries transient SDK failure %s", async (code) => {
  mocks.send.mockRejectedValue({ code });
  await expect(
    new FirebaseProvider().send({
      token: "device",
      title: "Test",
      body: "Test",
    }),
  ).rejects.toMatchObject({ retryable: true });
});
