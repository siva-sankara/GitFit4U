import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ background: vi.fn(), messaging: vi.fn() }));
vi.mock("@firebase/app", () => ({ initializeApp: () => ({}) }));
vi.mock("@firebase/messaging/sw", () => ({ getMessaging: mocks.messaging, onBackgroundMessage: mocks.background }));
vi.mock("./services/firebaseConfig", () => ({ firebaseConfig: { apiKey: "public-config", projectId: "test", appId: "app", messagingSenderId: "sender" } }));
const noticeId = "507f1f77bcf86cd799439011";
let click: (event: any) => void, background: (payload: any) => Promise<unknown> | undefined;
const clients = { matchAll: vi.fn(), openWindow: vi.fn() }, show = vi.fn();
beforeEach(async () => {
  vi.resetModules(); vi.clearAllMocks(); clients.matchAll.mockResolvedValue([]);
  mocks.background.mockImplementation((_messaging, handler) => { background = handler; });
  vi.stubGlobal("self", { location: new URL("https://getfit4u.in/assets/worker.js"), clients,
    registration: { showNotification: show }, addEventListener: (name: string, handler: any) => { if (name === "notificationclick") click = handler; } });
  await import("./firebase-messaging-sw");
});
afterEach(() => vi.unstubAllGlobals());
async function open(data: object) {
  let wait: Promise<unknown> | undefined;
  click({ stopImmediatePropagation: vi.fn(), notification: { data: { FCM_MSG: { data } }, close: vi.fn() }, waitUntil: (promise: Promise<unknown>) => { wait = promise; } });
  await wait;
}
it("opens the authenticated resolver on a cold start and ignores supplied URLs", async () => {
  await open({ notificationId: noticeId, navigationPath: "https://evil.example" });
  expect(clients.openWindow).toHaveBeenCalledWith(`https://getfit4u.in/notification-open/${noticeId}`);
});
it("navigates and focuses an existing window without relying on a page listener", async () => {
  const focus = vi.fn(), navigate = vi.fn().mockResolvedValue({ focus });
  clients.matchAll.mockResolvedValue([{ url: "https://getfit4u.in/app/home", navigate }]);
  await open({ notificationId: noticeId });
  expect(navigate).toHaveBeenCalledWith(`https://getfit4u.in/notification-open/${noticeId}`); expect(focus).toHaveBeenCalled();
  expect(clients.openWindow).not.toHaveBeenCalled();
});
it("displays no duplicate for provider-displayed notification payloads", async () => {
  await background({ notification: { title: "Update" }, data: { notificationId: noticeId } }); expect(show).not.toHaveBeenCalled();
  await background({ data: { notificationId: noticeId } }); expect(show).toHaveBeenCalledOnce();
});
it("uses the inbox for invalid identifiers", async () => {
  await open({ notificationId: "invalid", navigationPath: "/admin/payments" }); expect(clients.openWindow).toHaveBeenCalledWith("https://getfit4u.in/notifications");
});
it("opens a new window if the matching tab closes during navigation", async () => {
  clients.matchAll.mockResolvedValue([{ url: "https://getfit4u.in/app/home", navigate: vi.fn().mockRejectedValue(new Error("Tab closed")) }]);
  await open({ notificationId: noticeId });
  expect(clients.openWindow).toHaveBeenCalledWith(`https://getfit4u.in/notification-open/${noticeId}`);
});
