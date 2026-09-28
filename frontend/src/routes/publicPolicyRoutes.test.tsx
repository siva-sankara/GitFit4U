// @vitest-environment jsdom
import { isValidElement, type ReactElement } from "react";
import { expect, it } from "vitest";
import { PublicLayout } from "../layouts/PublicLayout";
import { publicPolicyRoutes } from "./publicPolicyRoutes";

it("keeps published policies and exact legacy aliases outside authentication wrappers", () => {
  expect(publicPolicyRoutes).toHaveLength(1);
  const root = publicPolicyRoutes[0];
  expect(root.path).toBeUndefined();
  expect(isValidElement(root.element)).toBe(true);
  expect((root.element as ReactElement).type).toBe(PublicLayout);
  expect(root.children?.map((route) => route.path)).toEqual([
    "/terms-and-policies",
    "/terms-and-conditions",
    "/privacy-policy",
    "/refund-cancellation-policy",
    "/data-deletion",
    "/legal/terms",
    "/legal/privacy",
  ]);
  for (const path of [
    "/terms-and-conditions",
    "/privacy-policy",
    "/refund-cancellation-policy",
    "/data-deletion",
  ]) {
    expect(root.children?.some((route) => route.path === path)).toBe(true);
  }
});
