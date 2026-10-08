// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Avatar } from "./Avatar";
let host: HTMLDivElement, root: Root;
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
async function show(props = {}) {
  const navigate = vi.fn();
  await act(async () => root.render(<div onClick={navigate} onDoubleClick={navigate} onKeyDown={event => { if (event.key === "Enter" || event.key === " ") navigate(); }}><Avatar name="Ada Member" src="/authorized-full.webp" thumbnailSrc="/small.webp" {...props} /></div>));
  const trigger = host.querySelector<HTMLButtonElement>("button.avatar")!;
  await act(async () => { trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); trigger.click(); trigger.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })); });
  return { trigger, navigate };
}
it.each(["image", "background", "close", "escape"])("opens the full authorized image and restores focus/scroll after %s dismissal", async method => {
  const { trigger, navigate } = await show();
  const dialog = document.querySelector('[role="dialog"]')!;
  await act(async () => dialog.querySelector("button")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
  expect(dialog).not.toBeNull(); expect(host.contains(dialog)).toBe(false);
  expect(dialog.querySelector("img")!.getAttribute("src")).toBe("/authorized-full.webp");
  expect(host.querySelector("img")!.getAttribute("src")).toBe("/small.webp");
  expect(document.body.style.overflow).toBe("hidden");
  await act(async () => {
    if (method === "escape") document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    else if (method === "background") (document.querySelector(".modal-backdrop") as HTMLElement).click();
    else if (method === "close") (dialog.querySelector('[aria-label="Close dialog"]') as HTMLElement).click();
    else (dialog.querySelector("img") as HTMLElement).click();
  });
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(document.activeElement).toBe(trigger); expect(document.body.style.overflow).toBe("");
  expect(navigate).not.toHaveBeenCalled();
});
it("handles failed full photos and clears a viewer on account change", async () => {
  await show();
  await act(async () => document.querySelector('[role="dialog"] img')!.dispatchEvent(new Event("error")));
  expect(document.querySelector('[role="alert"]')!.textContent).toContain("unavailable");
  await act(async () => window.dispatchEvent(new CustomEvent("gfu-auth", { detail: { changedSession: true } })));
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});
it("never opens initials/failed avatars and limits large sizing to profile variants", async () => {
  await act(async () => root.render(<><Avatar name="No Photo" /><Avatar name="Profile" variant="profile" src="/profile.webp" /><Avatar name="List" src="/list.webp" /></>));
  expect(host.querySelector('[aria-label="No Photo\'s profile photo"]')?.tagName).toBe("SPAN");
  expect(host.querySelectorAll(".avatar-profile")).toHaveLength(1);
  expect(host.querySelector('.avatar-profile')?.getAttribute("style")).toBeNull();
  const image = host.querySelector('img[src="/list.webp"]')!;
  await act(async () => image.dispatchEvent(new Event("error")));
  expect(host.querySelector('[aria-label="List\'s profile photo"]')?.tagName).toBe("SPAN");
});
