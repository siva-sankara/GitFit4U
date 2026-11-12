// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ query: {} as any, useData: vi.fn() }));
vi.mock("./LiveData", async original => ({ ...await original<typeof import("./LiveData")>(), useData: (path: string) => { mocks.useData(path); return mocks.query; } }));
vi.mock("../../services/session", () => ({ useSession: () => ({}) }));
vi.mock("../../context/AppContext", () => ({ useApp: () => ({ favorites: [], toggleFavorite: vi.fn() }) }));
vi.mock("../../services/apiClient", () => ({ getAccessToken: () => null, apiRequest: vi.fn() }));
import { LANDING_GYM_LIMIT, LiveLanding } from "./LivePublic";
let host: HTMLDivElement, root: Root;
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); host = document.createElement("div"); document.body.append(host); root = createRoot(host); mocks.useData.mockClear(); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
async function render(count: number, state = "success") {
  mocks.query = { isPending: state === "loading", isError: state === "error", isSuccess: state === "success", error: new Error("Unable to load gyms"), refetch: vi.fn(), ...(state === "success" ? { data: { data: Array.from({ length: count }, (_, i) => ({ _id: `gym-${i}`, publicId: `gym-${i}`, slug: `gym-${i}`, name: `Gym ${i}` })), meta: { total: 40, pages: 5 } } } : {}) };
  await act(async () => root.render(<MemoryRouter><LiveLanding /></MemoryRouter>));
}
it.each([0, 1, 5, 8, 9, 30])("bounds both the request and preview for %i returned gyms", async count => {
  await render(count);
  expect(mocks.useData).toHaveBeenCalledWith(`/api/v1/public/gyms?limit=${LANDING_GYM_LIMIT}`);
  expect(host.querySelectorAll(".gym-card")).toHaveLength(Math.min(8, count));
  expect(host.querySelector('.landing-section-heading a')?.getAttribute("href")).toBe("/explore");
  expect(host.textContent?.includes("No gyms are currently published")).toBe(count === 0);
  const titles = [...host.querySelectorAll(".gym-card .gym-identity-copy strong")].map(node => node.textContent);
  expect(titles).toEqual(Array.from({ length: Math.min(8, count) }, (_, i) => `Gym ${i}`));
});
it.each(["loading", "error"])("does not present %s as an empty result", async state => {
  await render(0, state); expect(host.textContent).not.toContain("No gyms are currently published");
  expect(host.querySelector('.landing-section-heading a')?.textContent).toContain("See all gyms");
});
