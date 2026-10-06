// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  MemoryRouter,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  refresh: vi.fn(),
  token: "session" as string | null,
  persisted: true,
}));
vi.mock("../services/apiClient", () => ({
  apiRequest: mocks.request,
  getAccessToken: () => mocks.token,
  hasPersistedSession: () => mocks.persisted,
  refreshSession: mocks.refresh,
  ApiError: class extends Error {
    constructor(public status: number) {
      super("Session error");
    }
  },
}));
import { ApiError } from "../services/apiClient";
import { GuestRoute } from "./GuestRoute";
import { ProtectedRoute } from "./ProtectedRoute";
let host: HTMLDivElement, root: Root, client: QueryClient;
function Destination() {
  const l = useLocation(),
    navigate = useNavigate();
  return (
    <>
      <output>
        {l.pathname}
        {l.search}
        {l.hash}
      </output>
      <button onClick={() => navigate(-1)}>Back</button>
    </>
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.token = "session";
  mocks.persisted = true;
  mocks.request.mockResolvedValue({ data: { context: { role: "USER" } } });
  mocks.refresh.mockResolvedValue(undefined);
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
  host.remove();
});
async function render(path: string, back = false) {
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <MemoryRouter key={path} initialEntries={back ? ["/", path] : [path]}>
          <Routes>
            <Route
              path="/private"
              element={
                <ProtectedRoute>
                  <p>Protected content</p>
                </ProtectedRoute>
              }
            />
            <Route
              path="/login"
              element={
                <GuestRoute auth>
                  <p>Guest login and signup</p>
                </GuestRoute>
              }
            />
            <Route
              path="/register"
              element={
                <GuestRoute auth>
                  <p>Guest login and signup</p>
                </GuestRoute>
              }
            />
            <Route
              path="/auth/*"
              element={
                <GuestRoute auth>
                  <p>Guest login and signup</p>
                </GuestRoute>
              }
            />
            <Route
              path="/"
              element={
                <GuestRoute>
                  <p>Public landing</p>
                </GuestRoute>
              }
            />
            <Route
              path="/explore"
              element={
                <GuestRoute>
                  <p>Public discovery</p>
                </GuestRoute>
              }
            />
            <Route
              path="/gyms/:slug"
              element={
                <GuestRoute>
                  <p>Public gym</p>
                </GuestRoute>
              }
            />
            <Route path="/app/*" element={<Destination />} />
            <Route path="/owner/*" element={<Destination />} />
            <Route path="/trainer/*" element={<Destination />} />
            <Route path="/admin/*" element={<Destination />} />
            <Route path="/register-gym" element={<Destination />} />
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
it.each(["/", "/login", "/register", "/auth/login", "/auth/signup"])(
  "redirects an authenticated member away from %s",
  async (path) => {
    await render(path);
    await until(() => host.textContent!.includes("/app/home"));
    expect(host.textContent).not.toContain("Guest login");
    expect(host.textContent).not.toContain("Public landing");
  },
);
it.each([
  ["GYM_OWNER", "/owner/dashboard"],
  ["GYM_STAFF", "/owner/dashboard"],
  ["TRAINER", "/trainer/dashboard"],
  ["ADMIN", "/admin/dashboard"],
])("uses the %s workspace", async (role, destination) => {
  mocks.request.mockResolvedValue({ data: { context: { role } } });
  await render("/");
  await until(() => host.textContent!.includes(destination));
});
it("does not check or refresh an anonymous session while browsing public pages", async () => {
  mocks.token = null;
  mocks.persisted = false;
  await render("/");
  expect(host.textContent).toContain("Public landing");
  await render("/explore");
  expect(host.textContent).toContain("Public discovery");
  await render("/login");
  expect(host.textContent).toContain("Guest login");
  expect(mocks.request).not.toHaveBeenCalled();
  expect(mocks.refresh).not.toHaveBeenCalled();
});
it("shows login for an expired session", async () => {
  mocks.request.mockRejectedValue(new ApiError(401, "expired", "expired"));
  mocks.refresh.mockRejectedValue(new ApiError(401, "expired", "expired"));
  await render("/auth/login");
  await until(() => host.textContent!.includes("Guest login"));
});
it("preserves the gym, selected plan and anchor inside the member workspace", async () => {
  await render("/gyms/selected-gym?plan=monthly#gym-plans");
  await until(() =>
    host.textContent!.includes("/app/gyms/selected-gym?plan=monthly#gym-plans"),
  );
});
it("keeps discovery filters while moving into the workspace", async () => {
  await render("/explore?q=Hyderabad&page=2");
  await until(() =>
    host.textContent!.includes("/app/explore?q=Hyderabad&page=2"),
  );
});
it("redirects browser-back navigation to the dashboard", async () => {
  await render("/app/home", true);
  await act(async () => host.querySelector("button")!.click());
  await until(() => host.textContent!.includes("/app/home"));
  expect(host.textContent).not.toContain("Public landing");
});
it("keeps safe gym return intent when already signed in", async () => {
  await render(
    "/auth/login?returnTo=" +
      encodeURIComponent("/app/gyms/selected?plan=monthly"),
  );
  await until(() =>
    host.textContent!.includes("/app/gyms/selected?plan=monthly"),
  );
});
it.each([429, 500, 0])(
  "keeps public navigation usable when the session endpoint returns %s",
  async (status) => {
    mocks.request.mockRejectedValue(
      new ApiError(status, "UNAVAILABLE", "Unavailable"),
    );
    await render("/");
    await until(() => client.getQueryState(["me"])?.status === "error");
    expect(host.textContent).toContain("Public landing");
    expect(host.textContent).not.toContain("Unable to check");
    await render("/explore");
    expect(host.textContent).toContain("Public discovery");
    await render("/login");
    expect(host.textContent).toContain("Guest login");
    expect(mocks.request.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(mocks.request.mock.calls.length).toBeLessThanOrEqual(3);
    expect(mocks.refresh).not.toHaveBeenCalled();
  },
);
it("renders public content immediately while an existing token is checked in the background", async () => {
  mocks.request.mockReturnValue(new Promise(() => {}));
  await render("/");
  expect(host.textContent).toContain("Public landing");
  expect(host.textContent).not.toContain("Checking your session");
});
it("reuses the verified session across public route changes", async () => {
  await render("/");
  await until(() => host.textContent!.includes("/app/home"));
  await render("/explore");
  await until(() => host.textContent!.includes("/app/explore"));
  await render("/login");
  await until(() => host.textContent!.includes("/app/home"));
  expect(mocks.request).toHaveBeenCalledOnce();
});
it("stops public session checks after logout even if identity data was cached", async () => {
  await render("/");
  await until(() => host.textContent!.includes("/app/home"));
  await act(async () => {
    mocks.token = null;
    window.dispatchEvent(new Event("gfu-auth"));
  });
  await render("/explore");
  expect(host.textContent).toContain("Public discovery");
  expect(mocks.request).toHaveBeenCalledOnce();
  expect(mocks.refresh).not.toHaveBeenCalled();
});
it("still restores and validates a refresh-cookie session when opening a protected route", async () => {
  mocks.token = null;
  mocks.persisted = false;
  mocks.refresh.mockImplementation(async () => {
    mocks.token = "restored";
  });
  await render("/");
  expect(mocks.refresh).not.toHaveBeenCalled();
  await render("/private");
  await until(() => host.textContent!.includes("Protected content"));
  expect(mocks.refresh).toHaveBeenCalledOnce();
  expect(mocks.request).toHaveBeenCalledWith("/api/v1/auth/me");
});
it("restores a hinted HttpOnly-cookie session before showing the login screen", async () => {
  mocks.token = null;
  mocks.persisted = true;
  mocks.refresh.mockImplementation(async () => {
    mocks.token = "restored";
  });
  await render("/login");
  expect(host.textContent).not.toContain("Guest login");
  await until(() => host.textContent!.includes("/app/home"));
  expect(mocks.refresh).toHaveBeenCalledOnce();
  expect(host.textContent).not.toContain("Guest login");
});
it("keeps protected content hidden when the session endpoint is rate limited", async () => {
  mocks.request.mockRejectedValue(
    new ApiError(429, "RATE_LIMITED", "Too many requests"),
  );
  await render("/private");
  await until(() => host.textContent!.includes("Unable to check your session"));
  expect(host.textContent).not.toContain("Protected content");
  await render("/");
  expect(host.textContent).toContain("Public landing");
  expect(mocks.request.mock.calls.length).toBeGreaterThanOrEqual(2);
  expect(mocks.request.mock.calls.length).toBeLessThanOrEqual(3);
});
it("uses persisted owner onboarding when reopening login in an installed app", async () => {
  mocks.request.mockResolvedValue({ data: { context: { role: "GYM_OWNER" }, user: { activeRole: "GYM_OWNER", onboarding: { state: "PENDING", registrationId: "existing" } } } });
  await render("/login?returnTo=%2Fowner%2Fmembers");
  await until(() => host.textContent!.includes("/register-gym"));
});
