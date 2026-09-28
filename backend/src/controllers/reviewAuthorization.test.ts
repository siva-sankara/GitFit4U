import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  update: vi.fn(),
  rating: vi.fn(),
  gym: vi.fn(),
  notification: vi.fn(),
}));
vi.mock("../models/Engagement.js", () => ({
  Review: { findOneAndUpdate: mocks.update },
  ClassSession: {},
  ClassBooking: {},
  Notification: {},
}));
vi.mock("../models/Gym.js", () => ({ Gym: { findById: mocks.gym } }));
vi.mock("../services/gymProjectionService.js", () => ({
  refreshGymRating: mocks.rating,
}));
vi.mock("../services/domainEventService.js", () => ({
  emitDomainEvent: mocks.notification,
}));
import { updateReview } from "./memberFeatureController.js";
beforeEach(() => vi.clearAllMocks());
it("scopes editing to authenticated ownership even when a foreign review ID is supplied", async () => {
  mocks.update.mockResolvedValue(null);
  await expect(
    updateReview(
      {
        auth: { userId: "actual-user" },
        params: { id: "foreign-review" },
        body: { rating: 1, status: "PUBLISHED", userId: "other-user" },
      } as any,
      {} as any,
    ),
  ).rejects.toMatchObject({ statusCode: 404 });
  expect(mocks.update.mock.calls[0][0]).toEqual({
    publicId: "foreign-review",
    userId: "actual-user",
  });
  expect(mocks.update.mock.calls[0][1].$set).not.toHaveProperty("userId");
  expect(mocks.update.mock.calls[0][1].$set).not.toHaveProperty("status");
  expect(mocks.rating).not.toHaveBeenCalled();
});
