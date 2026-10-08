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
  ApiError: class extends Error { constructor(public status: number, public code: string, message: string) { super(message); } },
}));
vi.mock("../../context/AppContext", () => ({
  useApp: () => ({ setRole: mocks.setRole }),
}));
import { AuthDesktopPage } from "./AuthDesktopPage";
import { ApiError } from "../../services/apiClient";
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
  vi.unstubAllEnvs();
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
          <Route path="/register-gym" element={<p>Register gym onboarding</p>} />
          <Route path="/admin/dashboard" element={<p>Admin home</p>} />
          <Route path="/trainer/dashboard" element={<p>Trainer home</p>} />
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
async function selectRole(role: "USER" | "GYM_OWNER") {
  await act(async () => host.querySelector<HTMLInputElement>(`input[name="role"][value="${role}"]`)!.click());
}
async function signupFields(role: "USER" | "GYM_OWNER" = "USER") {
  await selectRole(role);
  await fill("name", "Test Member");
  await fill("email", "member@example.com");
  await fill("phone", "9876543210");
  await fill("password", "StrongPass123");
  await fill("confirm", "StrongPass123");
}
const submittedOtp = {
  data: {
    challengeId: "signup-challenge-identifier",
    operationId: "signup-operation-identifier",
    maskedPhone: "+91••••••3210",
    expiresInSeconds: 300,
    resendInSeconds: 60,
    deliveryStatus: "SUBMITTED",
  },
};
function mockSignupSession(user: Record<string, unknown>) {
  mocks.request.mockImplementation(async (path) =>
    path === "/api/v1/auth/register"
      ? submittedOtp
      : { data: { accessToken: "token", user } },
  );
}
async function verifySignup() {
  await fill("code", "123456");
  await submit();
}
describe("account screens", () => {
  it("shows the transient test OTP in the login flow and clears it on successful login", async () => {
    mocks.request.mockImplementation(async (path) => path === "/api/v1/auth/otp/request"
      ? { data: { ...submittedOtp.data, deliveryStatus: "SIMULATED", developmentPreview: { code: "135790", simulated: true } } }
      : path.includes("/status") ? { data: { deliveryStatus: "SIMULATED", expired: false } }
        : { data: { accessToken: "token", user: { activeRole: "USER" } } });
    await render("/login"); await clickLink("Login with WhatsApp OTP");
    await fill("phone", "9876543210"); await submit();
    expect(host.textContent).toContain("Verify test login");
    expect(host.querySelector("output")?.textContent).toBe("135790");
    expect(host.textContent).toContain("No email was sent");
    expect(host.querySelector<HTMLInputElement>('input[name="code"]')!.value).toBe("");
    expect(sessionStorage.getItem("gfu_auth_challenge")).not.toContain("135790");
    await fill("code", "135790"); await submit();
    expect(host.textContent).toContain("Member home");
    expect(host.textContent).not.toContain("135790");
  });
  it("never exposes a preview attached to a normal delivery response", async () => {
    mocks.request.mockResolvedValue({ data: { ...submittedOtp.data, developmentPreview: { code: "135790", simulated: true } } });
    await render("/auth/phone"); await fill("phone", "9876543210"); await submit();
    expect(host.querySelector("output")).toBeNull();
    expect(host.textContent).not.toContain("135790");
    expect(sessionStorage.getItem("gfu_auth_challenge")).not.toContain("135790");
  });
  it("does not render a supplied simulated code in a production frontend", async () => {
    vi.stubEnv("DEV", false);
    mocks.request.mockResolvedValue({ data: { ...submittedOtp.data, deliveryStatus: "SIMULATED", developmentPreview: { code: "135790", simulated: true } } });
    await render("/auth/phone"); await fill("phone", "9876543210"); await submit();
    expect(host.querySelector("output")).toBeNull();
    expect(host.textContent).not.toContain("135790");
    expect(sessionStorage.getItem("gfu_auth_challenge")).not.toContain("135790");
  });
  it("shows a transient simulated preview without auto-filling or persisting the code", async () => {
    mocks.request.mockImplementation(async (path) => path === "/api/v1/auth/register"
      ? { data: { ...submittedOtp.data, deliveryStatus: "SIMULATED", developmentPreview: { code: "246810", simulated: true } } }
      : path.includes("/status") ? { data: { deliveryStatus: "SIMULATED", expired: false } }
        : { data: { accessToken: "token", user: { activeRole: "USER" } } });
    await render("/register"); await signupFields(); await submit();
    expect(host.textContent).toContain("Development only"); expect(host.textContent).toContain("246810");
    expect(host.textContent).toContain("No WhatsApp message was sent");
    expect(host.querySelector<HTMLInputElement>('input[name="code"]')!.value).toBe("");
    expect(sessionStorage.getItem("gfu_auth_challenge")).not.toContain("246810");
    await fill("code", "246810"); await submit();
    expect(host.textContent).toContain("Member home"); expect(host.textContent).not.toContain("246810");
    expect(sessionStorage.getItem("gfu_auth_challenge")).toBeNull();
  });
  it.each(["/register", "/auth/signup"])(
    "submits signup from %s and enters the member workspace",
    async (path) => {
      mockSignupSession({ activeRole: "USER" });
      await render(path);
      await fill("name", "Test Member");
      await fill("email", "member@example.com");
      await selectRole("USER");
      await fill("phone", "9876543210");
      await fill("password", "StrongPass123");
      await fill("confirm", "StrongPass123");
      await submit();
      expect(mocks.request.mock.calls[0][0]).toBe("/api/v1/auth/register");
      expect(JSON.parse(mocks.request.mock.calls[0][1].body)).toEqual({
        name: "Test Member",
        email: "member@example.com",
        role: "USER",
        password: "StrongPass123",
        phone: "+919876543210",
      });
      expect(host.textContent).toContain("Check WhatsApp");
      expect(host.textContent).toContain("+91••••••3210");
      expect(mocks.setToken).not.toHaveBeenCalled();
      await verifySignup();
      expect(mocks.request).toHaveBeenCalledWith("/api/v1/auth/signup/verify", {
        method: "POST",
        body: JSON.stringify({
          operationId: "signup-operation-identifier",
          challengeId: "signup-challenge-identifier",
          code: "123456",
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
  mockSignupSession({ activeRole: "USER" });
  await render(loginUrl);
  await clickLink("Create an account");
  await signupFields();
  await submit();
  await verifySignup();
  expect(host.textContent).toContain("Selected gym: " + selectedGym);
});
it("keeps the selected gym through the phone OTP flow", async () => {
  mocks.request.mockImplementation(async (path) =>
    path.endsWith("/request")
      ? { data: { challengeId: "challenge", maskedPhone: "+91••••••3210", expiresInSeconds: 300, resendInSeconds: 60, deliveryStatus: "SUBMITTED" } }
      : { data: { accessToken: "token", user: { activeRole: "USER" } } },
  );
  await render(loginUrl);
  await clickLink("Login with WhatsApp OTP");
  await fill("phone", "+919876543210");
  await submit();
  await fill("code", "123456");
  await submit();
  expect(host.textContent).toContain("Selected gym: " + selectedGym);
});
it("keeps the gym through password recovery and a subsequent login", async () => {
  mocks.request.mockImplementation(async (path) => {
    if (path.endsWith("/forgot-password"))
      return { data: { challengeId: "recovery", maskedPhone: "+91••••••3210", expiresInSeconds: 300, resendInSeconds: 60, deliveryStatus: "SUBMITTED" } };
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

it("requires a deliberate role choice and focuses the first invalid field", async () => {
  await render("/register");
  expect(host.querySelector('input[name="role"]:checked')).toBeNull();
  await submit();
  expect(mocks.request).not.toHaveBeenCalled();
  expect(host.textContent).toContain("Select your account type.");
  expect(host.querySelector('input[name="role"]')?.getAttribute("aria-invalid")).toBe("true");
  expect(document.activeElement?.getAttribute("name")).toBe("role");
});
it.each(["/app/home", "/owner/support"])("routes a new gym owner directly to onboarding despite return link %s", async returnTo => {
  mockSignupSession({ activeRole: "GYM_OWNER", onboarding: { state: "NOT_STARTED" } });
  await render(`/register?returnTo=${encodeURIComponent(returnTo)}`);
  await signupFields("GYM_OWNER");
  await submit();
  await verifySignup();
  expect(host.textContent).toContain("Register gym onboarding");
  expect(JSON.parse(mocks.request.mock.calls[0][1].body)).toMatchObject({ role: "GYM_OWNER", phone: "+919876543210" });
});
it.each([
  ["GYM_OWNER", "DRAFT", "Register gym onboarding"],
  ["GYM_OWNER", "PENDING", "Register gym onboarding"],
  ["GYM_OWNER", "ACTIVE", "Owner home"],
  ["ADMIN", undefined, "Admin home"],
  ["TRAINER", undefined, "Trainer home"],
])("uses persisted %s/%s status on login", async (activeRole, state, destination) => {
  mocks.request.mockResolvedValue({ data: { accessToken: "session", user: { activeRole, ...(state ? { onboarding: { state } } : {}) } } });
  await render("/login");
  expect(host.querySelector('input[name="role"]')).toBeNull();
  await fill("identifier", "account@example.com");
  await fill("password", "StrongPass123");
  await submit();
  expect(host.textContent).toContain(destination);
});
it("blocks a member's registration return link", async () => {
  mockSignupSession({ activeRole: "USER", roles: ["USER"] });
  await render("/register?returnTo=%2Fregister-gym");
  await signupFields();
  await submit();
  await verifySignup();
  expect(host.textContent).toContain("Member home");
});
it("keeps login/signup route state and clears irrelevant validation errors", async () => {
  await render("/register");
  expect(host.querySelector('.auth-tabs a[aria-current="page"]')?.textContent).toBe("Sign up");
  await submit();
  await clickLink("Log in");
  expect(host.querySelector('.auth-tabs a[aria-current="page"]')?.textContent).toBe("Log in");
  expect(host.textContent).not.toContain("Select your account type.");
  await clickLink("Sign up");
  expect(host.textContent).not.toContain("Select your account type.");
});
it("rejects an eleventh digit and malformed typing while preserving normal editing", async () => {
  await render("/register");
  const phone = host.querySelector<HTMLInputElement>('input[name="phone"]')!;
  expect(phone.type).toBe("tel");
  expect(phone.maxLength).toBe(10);
  expect(phone.autocomplete).toBe("tel-national");
  await fill("phone", "9876543210");
  await fill("phone", "98765432101");
  expect(phone.value).toBe("9876543210");
  expect(host.textContent).toContain("Enter a 10-digit mobile number.");
  for (const value of ["98765e3210", "98765.3210", "abcdef"]) {
    await fill("phone", value);
    expect(phone.value).toBe("9876543210");
  }
  await fill("phone", "987654321");
  expect(phone.value).toBe("987654321");
  await fill("phone", "");
  expect(phone.value).toBe("");
});
async function pastePhone(text: string, start = 0, end?: number) {
  const phone = host.querySelector<HTMLInputElement>('input[name="phone"]')!;
  phone.setSelectionRange(start, end ?? phone.value.length);
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", { value: { getData: () => text } });
  await act(async () => phone.dispatchEvent(event));
  return phone;
}
it("parses explicit +91 paste and autofill without silently truncating oversized or mixed input", async () => {
  await render("/register");
  await signupFields();
  let phone = await pastePhone("+91 91234-56789");
  expect(phone.value).toBe("9123456789");
  phone = await pastePhone("912345678901");
  expect(phone.value).toBe("9123456789");
  await submit();
  expect(mocks.request).not.toHaveBeenCalled();
  phone = await pastePhone("call 9123456789");
  expect(phone.value).toBe("9123456789");
  await fill("phone", "+919876543210");
  expect(phone.value).toBe("9876543210");
  phone = await pastePhone("12", 2, 4);
  expect(phone.value).toBe("9812543210");
});
it("keeps non-sensitive values and blocks repeated signup requests while pending", async () => {
  let reject!: (error: Error) => void;
  mocks.request.mockReturnValue(new Promise((_resolve, rejectRequest) => { reject = rejectRequest; }));
  await render("/register");
  await signupFields();
  await submit();
  await submit();
  expect(mocks.request).toHaveBeenCalledOnce();
  expect(host.querySelector<HTMLButtonElement>(".auth-submit")?.disabled).toBe(true);
  await act(async () => reject(new ApiError(409, "ACCOUNT_EXISTS", "Unable to create an account with these details. Sign in or recover your account.")));
  expect(host.querySelector<HTMLInputElement>('input[name="email"]')?.value).toBe("member@example.com");
  expect(host.textContent).toContain("Sign in or recover your account.");
});
it("offers intentional signup when an unknown phone cannot log in", async () => {
  mocks.request.mockRejectedValue(new ApiError(403, "SIGNUP_REQUIRED", "Create an account to continue."));
  await render("/auth/phone");
  await fill("phone", "9876543210");
  await submit();
  expect(host.querySelector('.form-alert a')?.textContent).toBe("Create an account");
  expect(host.querySelector('.form-alert a')?.getAttribute("href")).toBe("/register");
});
it("shows an asynchronous Meta delivery failure and disables verification", async () => {
  mocks.request.mockImplementation(async (path) => {
    if (path.endsWith("/otp/request"))
      return {
        data: {
          challengeId: "delivery-failure-challenge",
          maskedPhone: "+91••••••3210",
          expiresInSeconds: 300,
          resendInSeconds: 60,
          deliveryStatus: "SUBMITTED",
        },
      };
    if (path.includes("/status"))
      return { data: { deliveryStatus: "FAILED", expired: false } };
    throw new Error("Unexpected request");
  });
  await render("/auth/phone");
  await fill("phone", "9876543210");
  await submit();
  await act(async () => Promise.resolve());
  expect(host.textContent).toContain("WhatsApp could not deliver this verification message");
  const verify = [...host.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent?.trim() === "Verify",
  );
  expect(verify?.disabled).toBe(true);
});
