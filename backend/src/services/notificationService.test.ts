import { afterEach, beforeEach, expect, it, vi } from "vitest";
const firebase = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("../integrations/notifications/firebaseProvider.js", () => ({
  FirebaseProvider: class {
    send = firebase.send;
  },
  PushDeliveryError: class extends Error {
    code = "";
    retryable = false;
  },
  pushConfigured: () => true,
}));
vi.mock("../config/logger.js", () => ({ logger: { warn: vi.fn() } }));
import { Notification } from "../models/Engagement.js";
import { DeviceToken } from "../models/Collaboration.js";
import { Session } from "../models/Auth.js";
import { User } from "../models/User.js";
import { Gym } from "../models/Gym.js";
import { allowsPush, deliverPush } from "./notificationService.js";
beforeEach(() => {
  firebase.send.mockReset();
  firebase.send.mockResolvedValue({});
});
afterEach(() => vi.restoreAllMocks());
function setup(preferences: any = { push: true }) {
  const notification = {
    _id: "notice-one",
    userId: "user-one",
    category: "SYSTEM",
    title: "Private title",
    message: "Private contents",
    pushAttempts: 1,
    createdAt: new Date(),
    dedupeKey: "campaign:campaign-one",
  };
  const claim = vi.spyOn(Notification, "findOneAndUpdate").mockReturnValue({
    select: vi.fn().mockResolvedValue(notification),
  } as never);
  const user = vi.spyOn(User, "findById").mockImplementation(
    () =>
      ({
        select: () => ({
          lean: async () => ({
            status: "ACTIVE",
            notificationPreferences: preferences,
          }),
        }),
      }) as never,
  );
  vi.spyOn(Session, "find").mockReturnValue({
    select: () => ({ lean: async () => [{ publicId: "session-one" }] }),
  } as never);
  const session = vi
    .spyOn(Session, "exists")
    .mockResolvedValue({ _id: "session-one" } as never);
  const devices = vi.spyOn(DeviceToken, "find").mockReturnValue({
    select: async () => [
      {
        _id: "device-one",
        sessionId: "session-one",
        token: "private-device-token",
        tokenHash: "device-hash",
      },
    ],
  } as never);
  vi.spyOn(DeviceToken, "exists").mockResolvedValue({
    _id: "device-one",
  } as never);
  const active = vi
    .spyOn(Notification, "exists")
    .mockResolvedValue({ _id: "notice-one" } as never);
  const update = vi
    .spyOn(Notification, "updateOne")
    .mockResolvedValue({} as never);
  return { claim, user, devices, update, active, session, notification };
}
it("treats an explicitly empty category list as opting out of every push category", () => {
  expect(
    allowsPush(
      {
        status: "ACTIVE",
        notificationPreferences: { push: true, categories: [] },
      },
      "SYSTEM",
    ),
  ).toBe(false);
  expect(
    allowsPush(
      { status: "ACTIVE", notificationPreferences: { push: true } },
      "SYSTEM",
    ),
  ).toBe(true);
});
it("honors a preference disabled after notification queueing", async () => {
  const { devices, update, claim } = setup({ push: false });
  await deliverPush();
  expect(devices).not.toHaveBeenCalled();
  expect(firebase.send).not.toHaveBeenCalled();
  expect(claim.mock.calls[0][0]).toMatchObject({ archivedAt: null });
  expect(update.mock.calls.at(-1)?.[1]).toMatchObject({
    $set: { pushStatus: "SKIPPED" },
  });
});
it("checks preferences again before a leased device batch sends", async () => {
  const { user } = setup();
  let reads = 0;
  user.mockImplementation(
    () =>
      ({
        select: () => ({
          lean: async () => ({
            status: "ACTIVE",
            notificationPreferences: { push: reads++ === 0 },
          }),
        }),
      }) as never,
  );
  await deliverPush();
  expect(firebase.send).not.toHaveBeenCalled();
});
it("does not send a notification archived while its worker was running", async () => {
  const { active } = setup();
  active.mockResolvedValue(null);
  await deliverPush();
  expect(firebase.send).not.toHaveBeenCalled();
});
it("does not deliver to a session revoked after selecting devices", async () => {
  const { session } = setup();
  session.mockResolvedValue(null);
  await deliverPush();
  expect(firebase.send).not.toHaveBeenCalled();
});
it("keeps announcement contents out of push payloads", async () => {
  setup();
  await deliverPush();
  expect(firebase.send).toHaveBeenCalledWith(
    expect.objectContaining({
      title: "New announcement",
      body: "Open GETFIT4U to read your announcement.",
    }),
  );
  expect(JSON.stringify(firebase.send.mock.calls)).not.toContain(
    "Private contents",
  );
});
it("hands FCM an authenticated notification link, including for historical reminders", async () => {
  const { notification } = setup();
  const gymId = "507f1f77bcf86cd799439011";
  Object.assign(notification, { event: "platform.expiring", gymId, actionUrl: "/owner/platform-subscription" });
  vi.spyOn(Gym, "find").mockReturnValue({ select: () => ({ lean: async () => [{ _id: gymId, publicId: "target-gym" }] }) } as never);
  await deliverPush();
  expect(firebase.send).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ navigationPath: "/notification-open/notice-one" }) }));
});
