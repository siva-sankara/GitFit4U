// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ saved: [] as string[], toggle: vi.fn() }));
vi.mock("../../context/AppContext", () => ({
  useApp: () => ({
    favorites: mocks.saved,
    toggleFavorite: mocks.toggle,
    theme: "light",
    toggleTheme: vi.fn(),
  }),
}));
vi.mock("../../services/apiClient", () => ({
  getAccessToken: () => "session",
  apiRequest: vi.fn(),
}));
import { DatabaseGymCard } from "./LivePublic";
import { PublicHeader } from "../../components/PublicHeader";
let host: HTMLDivElement, root: Root;
const gym = { publicId: "gym-one", slug: "gym-one", name: "Gym One" };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.saved = [];
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
async function render(element: React.ReactNode) {
  await act(async () => root.render(<MemoryRouter>{element}</MemoryRouter>));
}
it("uses a default cover when the gym has no photo", async () => {
  await render(<DatabaseGymCard gym={gym} />);
  expect(host.querySelector("img")!.getAttribute("src")).toBe(
    "/assets/strength-card.webp",
  );
});
it("falls back when a saved cover URL cannot load", async () => {
  await render(
    <DatabaseGymCard
      gym={{ ...gym, coverImageUrl: "https://example.test/broken.jpg" }}
    />,
  );
  await act(async () =>
    host.querySelector("img")!.dispatchEvent(new Event("error")),
  );
  expect(host.querySelector("img")!.getAttribute("src")).toBe(
    "/assets/strength-card.webp",
  );
});
it("shows an accessible heart icon instead of save text", async () => {
  await render(<DatabaseGymCard gym={gym} />);
  const button = host.querySelector<HTMLButtonElement>(
    '[aria-label="Save Gym One"]',
  )!;
  expect(button.querySelector("svg")).not.toBeNull();
  expect(button.textContent).toBe("");
  await act(async () => button.click());
  expect(mocks.toggle).toHaveBeenCalledWith("gym-one");
});
it("fills the heart for saved gyms", async () => {
  mocks.saved = [gym.publicId];
  await render(<DatabaseGymCard gym={gym} />);
  const button = host.querySelector('[aria-pressed="true"]')!;
  expect(button.querySelector("svg")!.getAttribute("fill")).toBe(
    "currentColor",
  );
});
it("removes the signup link after Help from the public navbar", async () => {
  await render(<PublicHeader />);
  expect(host.querySelector('nav a[href="/auth/signup"]')).toBeNull();
  expect(host.querySelector('nav a[href="/help"]')).not.toBeNull();
});
