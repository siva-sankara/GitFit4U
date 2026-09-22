// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  MemoryRouter,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ApiError } from "../services/apiClient";
import { ProtectedRoute } from "./ProtectedRoute";
import { LegacyAuthRedirect } from "./LegacyAuthRedirect";
import { safeReturnTo, loginDestination } from "../services/authRedirect";

const mocks = vi.hoisted(() => ({ session: vi.fn() }));
vi.mock("../services/session", () => ({ useSession: mocks.session }));
let host: HTMLDivElement, root: Root;
function Location() {
  const location = useLocation(),
    navigate = useNavigate();
  return (
    <>
      <output>
        {location.pathname}
        {location.search}
        {location.hash}
        {JSON.stringify(location.state)}
      </output>
      <button onClick={() => navigate(-1)}>Back</button>
    </>
  );
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  mocks.session.mockReturnValue({
    isPending: false,
    isError: false,
    data: { data: { context: { role: "USER" } } },
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.clearAllMocks();
});
async function render(path: string, back = false) {
  await act(async () =>
    root.render(
      <MemoryRouter
        initialEntries={
          back
            ? ["/login", path]
            : [
                {
                  pathname: path.split(/[?#]/)[0],
                  search: path.includes("?")
                    ? "?" + path.split("?")[1].split("#")[0]
                    : "",
                  hash: path.includes("#") ? "#" + path.split("#")[1] : "",
                  state: { from: "/profile" },
                },
              ]
        }
      >
        <Routes>
          <Route
            path="/auth/login"
            element={<LegacyAuthRedirect to="/login" />}
          />
          <Route
            path="/signup"
            element={<LegacyAuthRedirect to="/register" />}
          />
          <Route path="/login" element={<Location />} />
          <Route path="/register" element={<Location />} />
          <Route
            path="/profile"
            element={
              <ProtectedRoute>
                <p>Private profile</p>
              </ProtectedRoute>
            }
          />
          <Route
            path="/owner/members"
            element={
              <ProtectedRoute>
                <p>Owner members data</p>
              </ProtectedRoute>
            }
          />
          <Route path="/app/home" element={<Location />} />
          <Route path="/trainer/dashboard" element={<Location />} />
          <Route path="/admin/dashboard" element={<Location />} />
        </Routes>
      </MemoryRouter>,
    ),
  );
}
it("redirects guests to canonical login and preserves private profile intent", async () => {
  mocks.session.mockReturnValue({
    isPending: false,
    isError: true,
    error: new ApiError(401, "UNAUTHENTICATED", "Sign in"),
  });
  await render("/profile");
  expect(host.textContent).toContain("/login?returnTo=%2Fprofile");
  expect(host.textContent).not.toContain("Private profile");
});
it.each([
  ["USER", "/app/home"],
  ["TRAINER", "/trainer/dashboard"],
  ["ADMIN", "/admin/dashboard"],
])("keeps %s out of the owner workspace", async (role, home) => {
  mocks.session.mockReturnValue({
    isPending: false,
    isError: false,
    data: { data: { context: { role } } },
  });
  await render("/owner/members", true);
  expect(host.textContent).toContain(home);
  expect(host.textContent).not.toContain("Owner members data");
  await act(async () => host.querySelector("button")!.click());
  expect(host.textContent).toContain("/login");
  expect(host.textContent).not.toContain(home);
});
it.each(["GYM_OWNER", "GYM_STAFF"])(
  "permits the active %s owner namespace",
  async (role) => {
    mocks.session.mockReturnValue({
      isPending: false,
      isError: false,
      data: { data: { context: { role } } },
    });
    await render("/owner/members");
    expect(host.textContent).toContain("Owner members data");
  },
);
it("keeps legacy auth query, hash and navigation state", async () => {
  await render("/auth/login?returnTo=%2Fgyms%2Fone%3Fplan%3Dmonthly#form");
  expect(host.textContent).toContain(
    '/login?returnTo=%2Fgyms%2Fone%3Fplan%3Dmonthly#form{"from":"/profile"}',
  );
});
it("maps the legacy signup URL to registration", async () => {
  await render("/signup?returnTo=%2Fprofile");
  expect(host.textContent).toContain("/register?returnTo=%2Fprofile");
});
it("does not disclose private content while checking the session or on service failure", async () => {
  mocks.session.mockReturnValue({ isPending: true });
  await render("/profile");
  expect(host.textContent).not.toContain("Private profile");
  mocks.session.mockReturnValue({
    isPending: false,
    isError: true,
    error: new Error("Session service unavailable"),
    refetch: vi.fn(),
  });
  await render("/profile");
  expect(host.textContent).toContain("Session service unavailable");
  expect(host.textContent).not.toContain("Private profile");
});
it("allows profile return intent and rejects external and cross-role return paths", () => {
  expect(safeReturnTo("/profile")).toBe("/profile");
  expect(loginDestination("USER", "/owner/members")).toBe("/app/home");
  expect(safeReturnTo("//external.example/profile")).toBeUndefined();
  expect(safeReturnTo("/app/../admin/dashboard")).toBeUndefined();
});
