import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  findUser: vi.fn(),
  follow: vi.fn(),
  remove: vi.fn(),
  updatePost: vi.fn(),
}));
vi.mock("../models/User.js", () => ({ User: { findOne: mocks.findUser } }));
vi.mock("../models/Social.js", () => ({
  Follow: { updateOne: mocks.follow, deleteOne: mocks.remove },
  SocialPost: { findOneAndUpdate: mocks.updatePost },
  SocialStory: {},
}));
vi.mock("../services/socialService.js", () => ({
  globalStreak: vi.fn(),
  storyExpiry: vi.fn(),
}));
import {
  follow,
  deleteContent,
  canReadSocialProfile,
  socialContentInput,
} from "./socialController.js";
import { profileUpdateInput } from "../routes/profileSchemas.js";
beforeEach(() => vi.resetAllMocks());
const req = (method = "POST") =>
  ({
    method,
    params: { id: "target", kind: "posts", contentId: "post-1" },
    auth: { userId: "viewer", role: "USER", permissions: [] },
  }) as any;
it("prevents self follows before writing", async () => {
  mocks.findUser.mockReturnValue({
    select: () => ({
      lean: async () => ({ _id: "viewer", social: { visibility: "PUBLIC" } }),
    }),
  });
  await expect(follow(req(), {} as any)).rejects.toMatchObject({
    code: "SELF_FOLLOW",
  });
  expect(mocks.follow).not.toHaveBeenCalled();
});
it("upserts duplicate-safe follows only from the authenticated identity", async () => {
  mocks.findUser.mockReturnValue({
    select: () => ({
      lean: async () => ({ _id: "target", social: { visibility: "PUBLIC" } }),
    }),
  });
  await follow(req(), { json: vi.fn() } as any);
  expect(mocks.follow).toHaveBeenCalledWith(
    { followerId: "viewer", followingId: "target" },
    expect.any(Object),
    expect.objectContaining({ upsert: true }),
  );
});
it("does not grant private profile access merely because a follow exists", () => {
  expect(
    canReadSocialProfile(
      { _id: "target", social: { visibility: "PRIVATE" } },
      "viewer",
    ),
  ).toBe(false);
  expect(canReadSocialProfile({ _id: "viewer" }, "viewer")).toBe(true);
});
it("scopes content deletion to its author unless platform admin permission is present", async () => {
  mocks.updatePost.mockResolvedValue(null);
  await expect(deleteContent(req("DELETE"), {} as any)).rejects.toMatchObject({
    code: "CONTENT_NOT_FOUND",
  });
  expect(mocks.updatePost.mock.calls[0][0]).toMatchObject({
    authorId: "viewer",
    publicId: "post-1",
    deletedAt: null,
  });
});
it("rejects arbitrary contact/role/url changes and invalid social payloads", () => {
  for (const body of [
    { email: "other@example.test" },
    { phone: "+919999999999" },
    { roles: ["ADMIN"] },
    { avatarUrl: "https://untrusted.test/photo.jpg" },
  ])
    expect(profileUpdateInput.safeParse(body).success).toBe(false);
  expect(
    profileUpdateInput.safeParse({ social: { timezone: "not/a-timezone" } })
      .success,
  ).toBe(false);
  expect(
    socialContentInput.safeParse({ text: "", attachmentIds: [] }).success,
  ).toBe(false);
});
it("allows removing a follow after the target has been disabled", async () => {
  mocks.findUser.mockImplementation((filter) => ({
    select: () => ({
      lean: async () =>
        filter.status ? null : { _id: "disabled-target", status: "DISABLED" },
    }),
  }));
  const response = { json: vi.fn() };
  await follow(req("DELETE"), response as any);
  expect(mocks.remove).toHaveBeenCalledWith({
    followerId: "viewer",
    followingId: "disabled-target",
  });
  expect(response.json).toHaveBeenCalledWith({
    success: true,
    data: { following: false },
  });
});
it("makes unfollow idempotent when a target account no longer exists", async () => {
  mocks.findUser.mockReturnValue({
    select: () => ({ lean: async () => null }),
  });
  const response = { json: vi.fn() };
  await follow(req("DELETE"), response as any);
  expect(mocks.remove).not.toHaveBeenCalled();
  expect(response.json).toHaveBeenCalledWith({
    success: true,
    data: { following: false },
  });
});
