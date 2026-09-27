// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import { Avatar } from "./Avatar";
it("uses a small thumbnail, preserves legacy photos and falls back to initials", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement("div"), root = createRoot(host);
  await act(async () => root.render(<Avatar user={{ name: "Ada Member", avatarUrl: "/large.jpg", avatarThumbnailUrl: "/thumb.webp" }} />));
  expect(host.querySelector("img")?.getAttribute("src")).toBe("/thumb.webp");
  await act(async () => root.render(<Avatar user={{ name: "Ada Member", avatarUrl: "/legacy.jpg" }} />));
  expect(host.querySelector("img")?.getAttribute("src")).toBe("/legacy.jpg");
  await act(async () => root.render(<Avatar name="Ada Member" />));
  expect(host.textContent).toBe("AM");
  expect(host.querySelector("[role=img]")?.getAttribute("aria-label")).toContain("Ada Member");
  await act(async () => root.unmount());
});
