// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  setToken: vi.fn(),
  setRole: vi.fn(),
}));
vi.mock("../../services/apiClient", () => ({
  apiRequest: mocks.request,
  setAccessToken: mocks.setToken,
  ApiError: class extends Error {},
}));
vi.mock("../../context/AppContext", () => ({
  useApp: () => ({ setRole: mocks.setRole }),
}));
import { AuthDesktopPage } from "./AuthDesktopPage";
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.resetAllMocks();
  sessionStorage.clear();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
function GymDestination() {
  const location = useLocation();
  return (
    <p>
      Selected gym: {location.pathname}
      {location.search}
      {location.hash}
    </p>
  );
}
async function render(path: string) {
  await act(async () =>
    root.render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/auth/*" element={<AuthDesktopPage />} />
          <Route path="/login" element={<AuthDesktopPage />} />
          <Route path="/register" element={<AuthDesktopPage />} />
          <Route path="/gyms/:slug" element={<GymDestination />} />
          <Route path="/app/home" element={<p>Member home</p>} />
          <Route path="/owner/dashboard" element={<p>Owner home</p>} />
        </Routes>
      </MemoryRouter>,
    ),
  );
}
async function fill(name: string, value: string) {
  const input = host.querySelector<HTMLInputElement>(`input[name="${name}"]`)!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
async function submit() {
  await act(async () => {
    host
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}
describe("account screens", () => {
  it.each(["/register", "/auth/signup"])(
    "submits signup from %s and enters the member workspace",
    async (path) => {
      mocks.request.mockResolvedValue({
        data: { accessToken: "token", user: { activeRole: "USER" } },
      });
      await render(path);
      await fill("name", "Test Member");
      await fill("email", "member@example.com");
      await fill("password", "StrongPass123");
      await fill("confirm", "StrongPass123");
      await submit();
      expect(mocks.request).toHaveBeenCalledWith("/api/v1/auth/register", {
        method: "POST",
        body: JSON.stringify({
          name: "Test Member",
          email: "member@example.com",
          password: "StrongPass123",
        }),
      });
      expect(mocks.setToken).toHaveBeenCalledWith("token");
      expect(host.textContent).toContain("Member home");
    },
  );
  it.each(["/login", "/auth/login"])(
    "logs in from %s and follows the role returned by the backend",
    async (path) => {
      mocks.request.mockResolvedValue({
        data: { accessToken: "owner-token", user: { activeRole: "GYM_OWNER" } },
      });
      await render(path);
      await fill("identifier", "owner@example.com");
      await fill("password", "StrongPass123");
      await submit();
      expect(mocks.request).toHaveBeenCalledWith(
        "/api/v1/auth/login",
        expect.anything(),
      );
      expect(host.textContent).toContain("Owner home");
    },
  );
  it("returns a direct OTP visit without a challenge to the phone form", async () => {
    await render("/auth/otp");
    expect(host.querySelector('input[name="phone"]')).not.toBeNull();
    expect(mocks.request).not.toHaveBeenCalled();
  });
});

const selectedGym = "/gyms/gym-two?plan=monthly#gym-plans";
const loginUrl = "/auth/login?returnTo=" + encodeURIComponent(selectedGym);
async function clickLink(text: string) {
  const link = [...host.querySelectorAll("a")].find(
    (a) => a.textContent === text,
  )!;
  expect(link).toBeTruthy();
  await act(async () =>
    link.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }),
    ),
  );
}
it("returns to the exact gym and selected membership after login", async () => {
  mocks.request.mockResolvedValue({
    data: { accessToken: "token", user: { activeRole: "USER" } },
  });
  await render(loginUrl);
  await fill("identifier", "member@example.com");
  await fill("password", "StrongPass123");
  await submit();
  expect(host.textContent).toContain("Selected gym: " + selectedGym);
});
it("keeps the selected gym when switching from login to signup", async () => {
  mocks.request.mockResolvedValue({
    data: { accessToken: "token", user: { activeRole: "USER" } },
  });
  await render(loginUrl);
  await clickLink("Create an account");
  await fill("name", "New Member");
  await fill("email", "member@example.com");
  await fill("password", "StrongPass123");
  await fill("confirm", "StrongPass123");
  await submit();
  expect(host.textContent).toContain("Selected gym: " + selectedGym);
});
it("keeps the selected gym through the phone OTP flow", async () => {
  mocks.request.mockImplementation(async (path) =>
    path.endsWith("/request")
      ? { data: { challengeId: "challenge", expiresInSeconds: 300 } }
      : { data: { accessToken: "token", user: { activeRole: "USER" } } },
  );
  await render(loginUrl);
  await clickLink("Continue with phone OTP");
  await fill("phone", "+919876543210");
  await submit();
  await fill("code", "123456");
  await submit();
  expect(host.textContent).toContain("Selected gym: " + selectedGym);
});
it("keeps the gym through password recovery and a subsequent login", async () => {
  mocks.request.mockImplementation(async (path) => {
    if (path.endsWith("/forgot-password"))
      return { data: { challengeId: "recovery", expiresInSeconds: 300 } };
    if (path.endsWith("/recovery/verify"))
      return { data: { resetToken: "reset" } };
    return { data: { accessToken: "token", user: { activeRole: "USER" } } };
  });
  await render(loginUrl);
  await clickLink("Forgot password?");
  await fill("phone", "+919876543210");
  await submit();
  await fill("code", "123456");
  await submit();
  await fill("password", "NewStrongPass123");
  await fill("confirm", "NewStrongPass123");
  await submit();
  await clickLink("Return to login");
  await fill("identifier", "member@example.com");
  await fill("password", "NewStrongPass123");
  await submit();
  expect(host.textContent).toContain("Selected gym: " + selectedGym);
});
it("rejects external return destinations", async () => {
  mocks.request.mockResolvedValue({
    data: { accessToken: "token", user: { activeRole: "USER" } },
  });
  await render(
    "/auth/login?returnTo=" + encodeURIComponent("//evil.example/gyms/test"),
  );
  await fill("identifier", "member@example.com");
  await fill("password", "StrongPass123");
  await submit();
  expect(host.textContent).toContain("Member home");
});
