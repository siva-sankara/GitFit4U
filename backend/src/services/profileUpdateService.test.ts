import { expect, it } from "vitest";
import { User } from "../models/User.js";
import { profileUpdateInput } from "../routes/profileSchemas.js";
import { profileUpdateOperation } from "./profileUpdateService.js";

it("clears only explicitly nullable profile fields using the real User schema", async () => {
  const user = new User({
    publicId: "profile-schema-check",
    name: "Ada",
    profile: {
      gender: "FEMALE",
      dateOfBirth: new Date("1990-01-01"),
      heightCm: 165,
      weightKg: 60,
      fitnessGoal: "Run 5 km",
      emergencyContact: {
        name: "Grace",
        phone: "+919876543210",
        relationship: "Friend",
      },
    },
  });
  const operation = profileUpdateOperation({
    profile: {
      gender: null,
      dateOfBirth: null,
      heightCm: null,
      weightKg: null,
    },
  });
  for (const field of Object.keys(operation.$unset || {}))
    user.set(field, undefined);
  await expect(user.validate()).resolves.toBeUndefined();
  expect(user.toObject().profile).not.toHaveProperty("dateOfBirth");
  expect(user.profile.gender).toBeUndefined();
  expect(user.profile.fitnessGoal).toBe("Run 5 km");
  expect(user.profile.emergencyContact.name).toBe("Grace");
  expect(
    profileUpdateInput.parse({ profile: { dateOfBirth: null } }).profile
      ?.dateOfBirth,
  ).toBeNull();
});

it("does not change omitted fields or accept arbitrary sensitive/unset paths", () => {
  const operation = profileUpdateOperation({ profile: { heightCm: 170 } });
  expect(operation.$set).toEqual({ "profile.heightCm": 170 });
  expect(operation.$unset).toBeUndefined();
  for (const input of [
    { roles: null },
    { email: null },
    { profile: null },
    { profile: { roles: ["ADMIN"] } },
    { "profile.gender": null },
    { $unset: { email: 1 } },
    { profile: { heightCm: "" } },
  ])
    expect(() => profileUpdateOperation(input)).toThrow();
});

it("removes avatar metadata together without permitting an arbitrary image URL", () => {
  expect(profileUpdateOperation({ avatarAttachmentId: null }).$unset).toEqual({
    avatarAttachmentId: 1,
    avatarUrl: 1,
  });
  expect(
    profileUpdateOperation({ avatarAttachmentId: "507f1f77bcf86cd799439011" }),
  ).toMatchObject({
    $set: { avatarAttachmentId: "507f1f77bcf86cd799439011" },
    $unset: { avatarUrl: 1 },
  });
});

it("declares the actual compound discovery index on the User model", () => {
  expect(User.schema.indexes().map(([keys]: any) => keys)).toContainEqual({
    status: 1,
    "social.visibility": 1,
    name: 1,
    _id: 1,
  });
});
