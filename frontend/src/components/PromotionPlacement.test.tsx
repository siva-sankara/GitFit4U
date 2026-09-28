// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("@tanstack/react-query", () => ({ useQuery: mocks.query }));
import { PromotionPlacement } from "./PromotionPlacement";
let host: HTMLDivElement, root: Root;
const ad = (id: string) => ({ publicId: id, name: `Promotion ${id}`, href: "/app/gyms/test#gym-plans", ctaLabel: "View plans", gymName: "Test Gym" });
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
async function render(ads: any[]) { mocks.query.mockReturnValue({ data: { data: ads } }); await act(async () => root.render(<MemoryRouter><PromotionPlacement placement="GYM_PROFILE" gymId="gym-1" /></MemoryRouter>)); }
it("renders no empty advertising block when there are no eligible ads", async () => { await render([]); expect(host.querySelector("section")).toBeNull(); });
it("keeps a single ad static and routes its real call to action", async () => { await render([ad("one")]); expect(host.querySelector("button")).toBeNull(); expect(host.querySelector("a")?.getAttribute("href")).toBe("/app/gyms/test#gym-plans"); });
it("lets users navigate multiple ads with visible controls and no automatic advance", async () => {
  await render([ad("one"), ad("two")]);
  const track = host.querySelector<HTMLDivElement>(".promotion-carousel-track")!;
  const scroll = vi.fn(); track.scrollTo = scroll; Object.defineProperty(track, "clientWidth", { value: 500 });
  expect(host.querySelector<HTMLButtonElement>('[aria-label="Previous promotion"]')!.disabled).toBe(true);
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Next promotion"]')!.click());
  expect(scroll).toHaveBeenCalledWith({ left: 500, behavior: "instant" });
  expect(host.querySelector('[aria-live="polite"]')!.textContent).toBe("Promotion 2 of 2");
  expect(host.querySelector<HTMLButtonElement>('[aria-label="Next promotion"]')!.disabled).toBe(true);
});
