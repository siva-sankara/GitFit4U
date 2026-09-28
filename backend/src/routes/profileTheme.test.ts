import { expect, it } from "vitest";
import { profileUpdateInput } from "./profileSchemas.js";
import { User } from "../models/User.js";

it.each(["light", "dark"])("preserves explicit %s account preferences", theme => {
  expect(profileUpdateInput.parse({ preferences: { theme } }).preferences?.theme).toBe(theme);
});
it("normalizes legacy System writes and defaults new users to Light", () => {
  expect(profileUpdateInput.parse({ preferences: { theme: "system" } }).preferences?.theme).toBe("light");
  expect(new User({ publicId: "new-user" }).preferences.theme).toBe("light");
  expect(new User({ publicId: "legacy-client", preferences: { theme: "system" } }).preferences.theme).toBe("light");
  expect(User.hydrate({ publicId: "stored-user", preferences: { theme: "system" } }).preferences.theme).toBe("light");
  expect(profileUpdateInput.safeParse({ preferences: { theme: "invalid" } }).success).toBe(false);
});
