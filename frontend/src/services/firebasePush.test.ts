// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  api: vi.fn(),
  token: "session" as string | null,
  getToken: vi.fn(),
  remove: vi.fn(),
  supported: vi.fn(),
  requestPermission: vi.fn(),
  register: vi.fn(),
  onMessage: vi.fn(),
}));
vi.mock("@firebase/app", () => ({
  getApps: () => [],
  initializeApp: () => ({}),
}));
vi.mock("@firebase/messaging", () => ({
  getMessaging: () => ({}),
  getToken: mocks.getToken,
  deleteToken: mocks.remove,
  isSupported: mocks.supported,
  onMessage: mocks.onMessage,
}));
vi.mock("./apiClient", () => ({
  apiRequest: mocks.api,
  getAccessToken: () => mocks.token,
}));
vi.mock("./firebaseConfig", () => ({
  firebaseConfig: {},
  firebaseConfigured: () => true,
}));
vi.mock("../firebase-messaging-sw.ts?worker&url", () => ({
  default: "/assets/firebase-worker.js",
}));
import {
  enablePush,
  disablePush,
  syncPushToken,
  listenForPush,
} from "./firebasePush";
beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  mocks.token = "session";
  vi.stubGlobal("Notification", {
    permission: "granted",
    requestPermission: mocks.requestPermission,
  });
  Object.defineProperty(window, "isSecureContext", {
    configurable: true,
    value: true,
  });
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: { register: mocks.register },
  });
  mocks.register.mockResolvedValue({ active: {} });
  mocks.api.mockResolvedValue({ data: {} });
  mocks.getToken.mockResolvedValue("new-device-token");
  mocks.remove.mockResolvedValue(true);
  mocks.supported.mockResolvedValue(true);
  mocks.requestPermission.mockResolvedValue("granted");
});
afterEach(() => vi.unstubAllGlobals());
it("requests permission only on explicit opt-in and registers the browser token", async () => {
  await syncPushToken();
  expect(mocks.requestPermission).not.toHaveBeenCalled();
  expect(mocks.api).not.toHaveBeenCalled();
  Object.assign(Notification, { permission: "default" });
  mocks.requestPermission.mockImplementation(async () => { Object.assign(Notification, { permission: "granted" }); return "granted"; });
  await enablePush();
  expect(mocks.requestPermission).toHaveBeenCalledOnce();
  expect(mocks.api).toHaveBeenCalledWith("/api/v1/devices", {
    method: "POST",
    body: JSON.stringify({ token: "new-device-token", platform: "WEB", deviceId: localStorage.getItem("gfu_push_device") }),
  });
  expect(mocks.register).toHaveBeenCalledWith("/assets/firebase-worker.js", {
    type: "module",
    scope: "/assets/",
  });
});
it("handles denied permission without registering a device", async () => {
  Object.assign(Notification, { permission: "denied" });
  await expect(enablePush()).rejects.toThrow("blocked");
  expect(mocks.requestPermission).not.toHaveBeenCalled();
  expect(mocks.api).not.toHaveBeenCalled();
});
it("handles unsupported browsers without breaking the inbox", async () => {
  mocks.supported.mockResolvedValue(false);
  await expect(enablePush()).rejects.toThrow("does not support");
  expect(mocks.requestPermission).not.toHaveBeenCalled();
});
it("refreshes a rotated token and revokes its previous registration", async () => {
  localStorage.setItem("gfu_push_enabled", "true");
  localStorage.setItem("gfu_push_token", "old-token");
  await syncPushToken();
  expect(mocks.api.mock.calls.map((c) => c[1].method)).toEqual([
    "POST",
    "DELETE",
  ]);
  expect(JSON.parse(mocks.api.mock.calls[1][1].body).token).toBe("old-token");
});
it("revokes the server device and Firebase token when disabling", async () => {
  localStorage.setItem("gfu_push_enabled", "true");
  localStorage.setItem("gfu_push_token", "old-token");
  await disablePush();
  expect(mocks.remove).toHaveBeenCalledOnce();
  expect(localStorage.getItem("gfu_push_enabled")).toBeNull();
  expect(mocks.api.mock.calls[0][1].method).toBe("DELETE");
});
it("does not register after the user logs out during token retrieval", async () => {
  localStorage.setItem("gfu_push_enabled", "true");
  mocks.getToken.mockImplementationOnce(async () => {
    mocks.token = null;
    return "token";
  });
  await syncPushToken();
  expect(mocks.api).not.toHaveBeenCalled();
});
it("passes foreground notifications to the inbox listener and supports cleanup", async () => {
  localStorage.setItem("gfu_push_enabled", "true");
  const stop = vi.fn(),
    received = vi.fn();
  mocks.onMessage.mockReturnValue(stop);
  expect(await listenForPush(received)).toBe(stop);
  mocks.onMessage.mock.calls[0][1]({
    notification: { title: "Membership active" },
    data: { notificationId: "notification-1" },
  });
  expect(received).toHaveBeenCalledWith({
    id: "notification-1",
    title: "Membership active",
    message: undefined,
    actionUrl: "/notifications",
  });
});
it("rolls back opt-in after device registration fails so settings can retry", async () => {
  mocks.api.mockRejectedValueOnce(new Error("Registration failed"));
  await expect(enablePush()).rejects.toThrow("Registration failed");
  expect(localStorage.getItem("gfu_push_enabled")).toBeNull();
});
it("ignores foreground pushes after logout or opt-out", async () => {
  const received = vi.fn();
  await listenForPush(received);
  const deliver = mocks.onMessage.mock.calls[0][1];
  deliver({ notification: { title: "Update" } });
  localStorage.setItem("gfu_push_enabled", "true");
  mocks.token = null;
  deliver({ notification: { title: "Update" } });
  expect(received).not.toHaveBeenCalled();
});
it("retains an existing opt-in if reconnecting fails temporarily", async () => {
  localStorage.setItem("gfu_push_enabled", "true");
  mocks.api.mockRejectedValueOnce(new Error("Temporary connection error"));
  await expect(enablePush()).rejects.toThrow("Temporary connection error");
  expect(localStorage.getItem("gfu_push_enabled")).toBe("true");
});
