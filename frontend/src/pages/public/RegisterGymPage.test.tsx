// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ request: vi.fn(), setToken: vi.fn() }));
vi.mock("../../services/apiClient", () => ({
  apiRequest: mocks.request,
  setAccessToken: mocks.setToken,
}));
vi.mock("../live/LivePublic", () => ({
  PaymentCheckout: ({ quoteBody, onComplete }: any) => (
    <div>
      Backend checkout for {quoteBody.planId}
      <button onClick={onComplete}>Refresh verified payment</button>
    </div>
  ),
}));
import { RegisterGymPage } from "./RegisterGymPage";
let host: HTMLDivElement, root: Root, client: QueryClient;
const gym = {
  _id: "gym-one",
  name: "First Gym",
  slug: "first-gym",
  status: "INACTIVE",
  platformSubscriptionStatus: "ACTIVE",
  contact: { phone: "9876501234", email: "first@example.com" },
  address: {
    line1: "First Street",
    city: "Hyderabad",
    state: "Telangana",
    postalCode: "500001",
  },
  location: { coordinates: [78, 17] },
};
let registrations: any[], plans: any[], paymentAvailable: boolean;
beforeEach(() => {
  vi.resetAllMocks();
  paymentAvailable = true;
  registrations = [
    {
      publicId: "registration-one",
      version: 0,
      status: "DRAFT",
      gymId: { ...gym },
    },
  ];
  plans = [
    {
      _id: "plan-one",
      name: "Admin Starter",
      priceMinor: 12500,
      currency: "INR",
      billingPeriod: "MONTHLY",
      features: ["Owner dashboard"],
    },
  ];
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  mocks.request.mockImplementation((path: string) => {
    if (path === "/api/v1/workspace/registrations")
      return Promise.resolve({ data: registrations });
    if (path === "/api/v1/workspace/registration-options")
      return Promise.resolve({ data: { paymentsAvailable: paymentAvailable } });
    if (path === "/api/v1/workspace/platform-plans")
      return Promise.resolve({ data: plans });
    if (path === "/api/v1/locations/config")
      return Promise.resolve({ data: { configured: false } });
    if (path === "/api/v1/auth/switch-role")
      return Promise.resolve({ data: { accessToken: "owner-session" } });
    return Promise.resolve({ data: {} });
  });
});
afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
  host.remove();
});
async function until(check: () => boolean) {
  for (let i = 0; i < 80 && !check(); i++)
    await act(async () => {
      await new Promise((resolve) => { setTimeout(resolve, 20); });
    });
  expect(check()).toBe(true);
}
function button(text: string) {
  return Array.from(host.querySelectorAll("button")).find(
    (b) => b.textContent === text,
  )!;
}
async function render() {
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={["/register-gym"]}>
          <Routes>
            <Route path="/register-gym" element={<RegisterGymPage />} />
            <Route path="/auth/login" element={<p>User login opened</p>} />
            <Route
              path="/owner/dashboard"
              element={<p>Owner dashboard opened</p>}
            />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    ),
  );
  await until(() => host.textContent!.includes("First Gym"));
}
it("preserves profile and location while replacing uploads with backend plans", async () => {
  await render();
  await until(() => host.textContent!.includes("Admin Starter"));
  expect(
    host.querySelector<HTMLInputElement>('input[type="email"]')?.value,
  ).toBe("first@example.com");
  expect(
    host.querySelector('[aria-label="Selected longitude"]')?.textContent,
  ).toBe("78.000000");
  expect(host.querySelector('input[type="file"]')).toBeNull();
  expect(host.textContent).not.toContain("Verification documents");
  expect(host.textContent).toContain("125.00");
  const choice = Array.from(host.querySelectorAll("button")).find((b) =>
    b.textContent?.includes("Admin Starter"),
  )!;
  await act(async () => choice.click());
  await until(() =>
    host.textContent!.includes("Backend checkout for plan-one"),
  );
  expect(button("Open gym owner workspace")).toBeUndefined();
  expect(
    mocks.request.mock.calls.some((call) =>
      String(call[0]).includes("documents"),
    ),
  ).toBe(false);
});
it.each(["PAYMENT_FAILED", "PAYMENT_CANCELLED"])(
  "allows retry from %s without exposing the gym",
  async (state) => {
    registrations[0].status = state;
    registrations[0].selectedPlatformPlanId = "plan-one";
    await render();
    await until(() =>
      host.textContent!.includes("Backend checkout for plan-one"),
    );
    expect(host.textContent).toContain("Payment was not completed");
    expect(host.textContent).toContain("inactive and hidden");
    expect(button("Open gym owner workspace")).toBeUndefined();
  },
);
it("reflects server activation and switches to the paid gym workspace", async () => {
  registrations[0].status = "ACTIVE";
  registrations[0].gymId.status = "ACTIVE";
  await render();
  expect(host.textContent).toContain("Your gym is active");
  expect(host.textContent).not.toContain("Choose a registration plan");
  await act(async () => button("Open gym owner workspace").click());
  await until(() => host.textContent!.includes("Owner dashboard opened"));
  expect(mocks.setToken).toHaveBeenCalledWith("owner-session");
  expect(mocks.request).toHaveBeenCalledWith("/api/v1/auth/switch-role", {
    method: "POST",
    body: JSON.stringify({ role: "GYM_OWNER", gymId: "gym-one" }),
  });
});
it("refreshes registration from the backend after verified checkout", async () => {
  registrations[0].selectedPlatformPlanId = "plan-one";
  await render();
  await until(() => Boolean(button("Refresh verified payment")));
  registrations = [
    {
      ...registrations[0],
      status: "ACTIVE",
      gymId: { ...gym, status: "ACTIVE" },
    },
  ];
  await act(async () => button("Refresh verified payment").click());
  await until(() => Boolean(button("Open gym owner workspace")));
  expect(host.textContent).toContain("Members can now find it");
});
it("requires changed location to be confirmed and saved before payment", async () => {
  registrations[0].selectedPlatformPlanId = "plan-one";
  await render();
  await until(() => host.textContent!.includes("Backend checkout"));
  await act(async () => {
    const input = host.querySelector<HTMLInputElement>('[aria-label="City"]')!;
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(input, "Secunderabad");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(button("Save details").disabled).toBe(true);
  expect(host.textContent).not.toContain("Backend checkout");
  await act(async () =>
    host
      .querySelector<HTMLInputElement>(".registration-confirm input")!
      .click(),
  );
  await act(async () =>
    host
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  await until(() => host.textContent!.includes("Backend checkout"));
  const saved = mocks.request.mock.calls.find(
    (call) => call[0] === "/api/v1/owner/registrations/registration-one",
  )!;
  expect(JSON.parse(saved[1].body).gym).toMatchObject({
    address: { city: "Secunderabad" },
    location: { coordinates: [78, 17] },
  });
});
it("explains missing gateway configuration without offering checkout", async () => {
  paymentAvailable = false;
  registrations[0].selectedPlatformPlanId = "plan-one";
  await render();
  await until(() =>
    host.textContent!.includes("Online payment is currently unavailable"),
  );
  expect(host.textContent).not.toContain("Backend checkout");
});
it("enables checkout after payment configuration becomes available", async () => {
  paymentAvailable = false;
  registrations[0].selectedPlatformPlanId = "plan-one";
  await render();
  await until(() => Boolean(button("Check payment availability")));
  paymentAvailable = true;
  await act(async () => button("Check payment availability").click());
  await until(() =>
    host.textContent!.includes("Backend checkout for plan-one"),
  );
  expect(host.textContent).not.toContain(
    "Online payment is currently unavailable",
  );
});
it("does not offer payment for a suspended gym", async () => {
  registrations[0].status = "SUSPENDED";
  registrations[0].gymId.status = "SUSPENDED";
  await render();
  expect(host.textContent).toContain("suspended or archived");
  expect(host.textContent).not.toContain("Choose a registration plan");
});

it.each([
  "DRAFT",
  "PAYMENT_PENDING",
  "PAYMENT_FAILED",
  "PAYMENT_CANCELLED",
  "SUSPENDED",
])("returns to user login when going back from %s", async (status) => {
  registrations[0].status = status;
  await render();
  await act(async () => button("Back").click());
  await until(() => host.textContent!.includes("User login opened"));
  expect(
    mocks.request.mock.calls.some(
      (call) => call[0] === "/api/v1/auth/switch-role",
    ),
  ).toBe(false);
});

it("opens the selected active gym owner dashboard when going back", async () => {
  registrations.push({
    publicId: "registration-two",
    status: "ACTIVE",
    gymId: { ...gym, _id: "gym-two", name: "Second Gym", status: "ACTIVE" },
  });
  await render();
  await act(async () => {
    const select = host.querySelector<HTMLSelectElement>(
      '[aria-label="Registration"]',
    )!;
    select.value = "registration-two";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await act(async () => button("Back").click());
  await until(() => host.textContent!.includes("Owner dashboard opened"));
  expect(mocks.request).toHaveBeenCalledWith("/api/v1/auth/switch-role", {
    method: "POST",
    body: JSON.stringify({ role: "GYM_OWNER", gymId: "gym-two" }),
  });
  expect(mocks.setToken).toHaveBeenCalledWith("owner-session");
});

it("checks the latest server activation before deciding where Back goes", async () => {
  await render();
  registrations = [
    {
      ...registrations[0],
      status: "ACTIVE",
      gymId: { ...gym, status: "ACTIVE" },
    },
  ];
  await act(async () => button("Back").click());
  await until(() => host.textContent!.includes("Owner dashboard opened"));
});

it("returns an unsaved new registration to login even if another gym is active", async () => {
  registrations[0].status = "ACTIVE";
  registrations[0].gymId.status = "ACTIVE";
  await render();
  await act(async () => button("Register another gym").click());
  await act(async () => button("Back").click());
  await until(() => host.textContent!.includes("User login opened"));
  expect(
    mocks.request.mock.calls.some(
      (call) => call[0] === "/api/v1/auth/switch-role",
    ),
  ).toBe(false);
});

it("shows a role-switch failure without navigating to the owner dashboard", async () => {
  registrations[0].status = "ACTIVE";
  registrations[0].gymId.status = "ACTIVE";
  const original = mocks.request.getMockImplementation()!;
  mocks.request.mockImplementation((path, ...rest) =>
    path === "/api/v1/auth/switch-role"
      ? Promise.reject(new Error("Gym access could not be selected"))
      : original(path, ...rest),
  );
  await render();
  await act(async () => button("Back").click());
  await until(() =>
    host.textContent!.includes("Gym access could not be selected"),
  );
  expect(host.textContent).not.toContain("Owner dashboard opened");
  expect(mocks.setToken).not.toHaveBeenCalled();
});
