import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  upsert: vi.fn(),
  update: vi.fn(),
  updateMany: vi.fn(),
  count: vi.fn(),
}));
vi.mock("../models/Collaboration.js", () => ({
  DeviceToken: {
    findOneAndUpdate: mocks.upsert,
    updateOne: mocks.update,
    updateMany: mocks.updateMany,
    countDocuments: mocks.count,
  },
}));
vi.mock("../integrations/notifications/firebaseProvider.js", () => ({
  pushConfigured: () => true,
}));
import { register, revoke, status } from "./deviceController.js";
const req = () =>
  ({
    auth: { userId: "user", sessionId: "current-session" },
    body: {
      token: "private-fcm-token",
      platform: "WEB",
      deviceId: "device-id",
    },
  }) as any;
const res = () => {
  const response: any = { json: vi.fn(), send: vi.fn() };
  response.status = vi.fn().mockReturnValue(response);
  return response;
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.upsert.mockReturnValue({
    select: async () => ({
      _id: "device",
      tokenHash: "private-hash",
      platform: "WEB",
      permission: "GRANTED",
    }),
  });
});
it("binds device tokens to the authenticated user/session and does not return token material", async () => {
  const response = res();
  await register(req(), response);
  expect(mocks.upsert.mock.calls[0][1].$set).toMatchObject({
    userId: "user",
    sessionId: "current-session",
    permission: "GRANTED",
  });
  expect(response.json.mock.calls[0][0].data).not.toHaveProperty("tokenHash");
  expect(response.json.mock.calls[0][0].data).not.toHaveProperty("token");
});
it("deactivates only rotated tokens for this browser rather than other devices", async () => {
  await register(req(), res());
  expect(mocks.updateMany.mock.calls[0][0]).toMatchObject({
    userId: "user",
    deviceId: "device-id",
    revokedAt: null,
    tokenHash: { $ne: expect.any(String) },
  });
});
it("a stale session cannot revoke a token rebound to another login session", async () => {
  await revoke(req(), res());
  expect(mocks.update.mock.calls[0][0]).toMatchObject({
    userId: "user",
    sessionId: "current-session",
  });
});
it("reports actual current-session push registration without returning tokens", async () => {
  mocks.count.mockResolvedValue(2);
  const response = res();
  await status(req(), response);
  expect(response.json).toHaveBeenCalledWith({
    success: true,
    data: { configured: true, registered: true, activeDevices: 2 },
  });
  expect(mocks.count.mock.calls[0][0]).toMatchObject({
    sessionId: "current-session",
    userId: "user",
  });
});
