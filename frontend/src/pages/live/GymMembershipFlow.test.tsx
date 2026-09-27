// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  token: null as string | null,
}));
vi.mock("../../services/apiClient", () => {
  class ApiError extends Error {
    constructor(
      public status: number,
      public code: string,
      message: string,
    ) {
      super(message);
    }
  }
  return {
    apiRequest: mocks.request,
    ApiError,
    getAccessToken: () => mocks.token,
    setAccessToken: (token: string | null) => {
      if (mocks.token === token) return;
      const changedSession = !mocks.token || !token;
      mocks.token = token;
      // Match AppProvider's cache invalidation when authentication changes.
      if (changedSession) client.clear();
      window.dispatchEvent(
        new CustomEvent("gfu-auth", { detail: { token, changedSession } }),
      );
    },
    refreshSession: async () => {
      if (!mocks.token) throw new ApiError(401, "UNAUTHENTICATED", "Sign in");
    },
  };
});
vi.mock("../../context/AppContext", () => ({
  useApp: () => ({ favorites: [], toggleFavorite: vi.fn(), setRole: vi.fn() }),
}));
vi.mock("../public/GymDetailsView", () => ({
  GymDetailsView: ({ data, onChoosePlan }: any) => (
    <>
      <h1>{data.gym.name}</h1>
      {data.plans.map((plan: any) => (
        <button key={plan._id} onClick={() => onChoosePlan(plan)}>
          {plan.name}
        </button>
      ))}
    </>
  ),
}));
import { LiveGymDetails, DatabaseGymCard } from "./LivePublic";
import { ProtectedRoute } from "../../routes/ProtectedRoute";
import { AuthDesktopPage } from "../public/AuthDesktopPage";
let host: HTMLDivElement, root: Root, client: QueryClient;
const gym = {
  _id: "gym-id",
  publicId: "gym-public",
  slug: "selected-gym",
  name: "Selected Gym",
  facilities: [],
};
const plan = {
  _id: "plan-id",
  publicId: "monthly",
  name: "Monthly membership",
  priceMinor: 150000,
  durationDays: 30,
};
function CurrentPath() {
  const l = useLocation();
  return (
    <output>
      {l.pathname}
      {l.search}
      {l.hash}
    </output>
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.token = null;
  sessionStorage.clear();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  mocks.request.mockImplementation(async (path) => {
    if (path === "/api/v1/auth/login")
      return { data: { accessToken: "session", user: { activeRole: "USER" } } };
    if (path === "/api/v1/auth/me")
      return { data: { context: { role: "USER" } } };
    if (path === "/api/v1/checkout/quotes")
      return {
        data: {
          publicId: "quote",
          planSnapshot: plan,
          subtotalMinor: 150000,
          totalMinor: 150000,
          currency: "INR",
        },
      };
    if (path === "/api/v1/public/gyms/selected-gym")
      return { data: { gym, plans: [plan] } };
    throw new Error("Unexpected endpoint: " + path);
  });
});
afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
  host.remove();
});
async function render(path: string) {
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[path]}>
          <CurrentPath />
          <Routes>
            <Route path="/" element={<DatabaseGymCard gym={gym} />} />
            <Route path="/auth/*" element={<AuthDesktopPage />} />
            <Route path="/login" element={<AuthDesktopPage />} />
            <Route path="/register" element={<AuthDesktopPage />} />
            <Route
              path="/gyms/:slug"
              element={
                <ProtectedRoute>
                  <LiveGymDetails />
                </ProtectedRoute>
              }
            />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    ),
  );
}
async function until(check: () => boolean) {
  for (let n = 0; n < 80 && !check(); n++)
    await act(async () => {
      await new Promise((r) => { setTimeout(r, 15); });
    });
  expect(check()).toBe(true);
}
async function login() {
  for (const [name, value] of [
    ["identifier", "member@example.com"],
    ["password", "StrongPass123"],
  ]) {
    await act(async () => {
      const input = host.querySelector(`input[name="${name}"]`)!;
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }
  await act(async () =>
    host
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
}
it("asks landing-page visitors to log in and then opens the exact selected gym with its plans", async () => {
  await render("/");
  await act(async () =>
    host
      .querySelector<HTMLAnchorElement>('a[href="/gyms/selected-gym"]')!
      .click(),
  );
  await until(() => !!host.querySelector('input[name="identifier"]'));
  expect(mocks.request).not.toHaveBeenCalledWith(
    "/api/v1/public/gyms/selected-gym",
  );
  await login();
  await until(() => host.textContent!.includes("Monthly membership"));
  expect(host.querySelector("output")!.textContent).toBe("/gyms/selected-gym");
});
it("restores the selected membership after login and requests a quote without starting payment", async () => {
  await render("/gyms/selected-gym?plan=plan-id#gym-plans");
  await until(() => !!host.querySelector('input[name="identifier"]'));
  await login();
  await until(() =>
    mocks.request.mock.calls.some((c) => c[0] === "/api/v1/checkout/quotes"),
  );
  expect(mocks.request).toHaveBeenCalledWith("/api/v1/checkout/quotes", {
    method: "POST",
    body: JSON.stringify({ gymId: "gym-id", planId: "plan-id" }),
  });
  expect(mocks.request.mock.calls.some((c) => c[0].endsWith("/orders"))).toBe(
    false,
  );
});
it("does not checkout a removed plan and lets an authenticated member choose a current plan", async () => {
  mocks.token = "session";
  await render("/gyms/selected-gym?plan=removed");
  await until(() => host.textContent!.includes("no longer available"));
  expect(
    mocks.request.mock.calls.some((c) => c[0] === "/api/v1/checkout/quotes"),
  ).toBe(false);
  await act(async () =>
    [...host.querySelectorAll("button")]
      .find((b) => b.textContent === "Monthly membership")!
      .click(),
  );
  await until(() => !!document.querySelector('[role="dialog"]'));
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Membership checkout");
});
