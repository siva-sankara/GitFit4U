// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("../../services/apiClient", () => ({ apiRequest: mocks.request }));
import {
  MemberSubscriptions,
  type MemberSubscription,
} from "./MemberSubscriptions";
const membership: MemberSubscription = {
  _id: "subscription-id",
  publicId: "monthly",
  status: "ACTIVE",
  gymId: { _id: "gym-id", name: "Oak Gym", slug: "oak-gym" },
  planSnapshot: {
    name: "Monthly plan",
    planId: "plan-public",
    totalMinor: 150000,
    freezeDaysAllowed: 5,
  },
  startsAt: new Date(Date.now() - 86400000).toISOString(),
  endsAt: new Date(Date.now() + 30 * 86400000).toISOString(),
};
let host: HTMLDivElement, root: Root, client: QueryClient;
beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  mocks.request.mockResolvedValue({
    success: true,
    data: [membership],
    meta: { page: 1, pages: 1, total: 1 },
  });
});
afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
  host.remove();
});
async function render() {
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={["/app/subscriptions"]}>
          <MemberSubscriptions />
        </MemoryRouter>
      </QueryClientProvider>,
    ),
  );
}
async function until(check: () => boolean) {
  for (let i = 0; i < 60 && !check(); i++)
    await act(async () => {
      await new Promise((resolve) => { setTimeout(resolve, 15); });
    });
  expect(check()).toBe(true);
}
async function click(text: string) {
  const button = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (entry) => entry.textContent === text,
  );
  expect(button).toBeTruthy();
  await act(async () => button!.click());
}
async function reason() {
  const textarea = document.querySelector("[role=dialog] textarea")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )!.set!.call(textarea, "Moving to another city");
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
it("shows accessible skeletons while the first request is pending", async () => {
  mocks.request.mockReturnValue(new Promise(() => {}));
  await render();
  expect(
    host.querySelector('[aria-label="Loading subscriptions"]'),
  ).not.toBeNull();
  expect(host.textContent).not.toContain("no gym subscriptions");
});
it("shows a useful empty state without inventing memberships", async () => {
  mocks.request.mockResolvedValue({ success: true, data: [] });
  await render();
  await until(() => !!host.querySelector(".subscription-empty"));
  expect(host.textContent).toContain("You have no gym subscriptions yet");
  expect(host.querySelector('a[href="/app/explore"]')).not.toBeNull();
});
it("renders real plan details and gym scanner access for a current active membership", async () => {
  await render();
  await until(() => host.textContent!.includes("Oak Gym"));
  expect(host.textContent).toContain("Monthly plan");
  expect(host.textContent).toContain("1,500.00");
  expect(
    host.querySelector('a[href="/app/attendance/qr?gymId=gym-id"]'),
  ).not.toBeNull();
  expect(host.querySelector('a[href="/app/gyms/oak-gym"]')).not.toBeNull();
});
it("offers pending payment continuation for the saved plan without enabling access", async () => {
  mocks.request.mockResolvedValue({
    success: true,
    data: [
      {
        ...membership,
        status: "PENDING_PAYMENT",
        startsAt: undefined,
        endsAt: undefined,
      },
    ],
  });
  await render();
  await until(() => host.textContent!.includes("Continue payment"));
  expect(host.textContent).toContain(
    "Gym access begins only after payment is verified",
  );
  expect(
    host.querySelector('a[href="/app/gyms/oak-gym?plan=plan-public"]'),
  ).not.toBeNull();
  expect(host.textContent).not.toContain("Scan gym QR");
  expect(
    [...host.querySelectorAll("button")].some(
      (entry) => entry.textContent === "Cancel",
    ),
  ).toBe(false);
});
it("handles missing gym and plan references without rendering zero prices or crashing", async () => {
  mocks.request.mockResolvedValue({
    success: true,
    data: [{ ...membership, gymId: null, planSnapshot: null }],
  });
  await render();
  await until(() => host.textContent!.includes("Gym unavailable"));
  expect(host.textContent).toContain("Not available");
  expect(host.querySelector('a[href="/app/support"]')).not.toBeNull();
  expect(host.textContent).not.toContain("Scan gym QR");
});
it("retains cards while loading the next page and disables repeated pagination", async () => {
  mocks.request.mockImplementation((path: string) =>
    path.includes("page=2")
      ? new Promise(() => {})
      : Promise.resolve({
          success: true,
          data: [membership],
          meta: { page: 1, pages: 2, total: 13 },
        }),
  );
  await render();
  await until(() => host.textContent!.includes("Oak Gym"));
  await click("Next");
  expect(host.textContent).toContain("Oak Gym");
  expect(
    host.querySelector('.member-subscription-grid[aria-busy="true"]'),
  ).not.toBeNull();
  expect(
    [...host.querySelectorAll("button")].find(
      (entry) => entry.textContent === "Next",
    )?.disabled,
  ).toBe(true);
});
it("shows a request error promptly and retries successfully", async () => {
  mocks.request.mockRejectedValueOnce(new Error("Connection interrupted"));
  await render();
  await until(() => host.textContent!.includes("Connection interrupted"));
  expect(host.querySelector(".subscription-empty")).toBeNull();
  await click("Try again");
  await until(() => host.textContent!.includes("Oak Gym"));
});
it("shows submitting feedback, blocks duplicates, and closes after backend success without waiting for unrelated requests", async () => {
  let complete: (result: unknown) => void = () => {};
  const unresolved = new Promise((resolve) => {
    complete = resolve;
  });
  mocks.request.mockImplementation((_path: string, options?: RequestInit) =>
    options?.method === "POST"
      ? unresolved
      : Promise.resolve({ success: true, data: [membership] }),
  );
  await render();
  await until(() => host.textContent!.includes("Oak Gym"));
  const invalidate = vi
    .spyOn(client, "invalidateQueries")
    .mockReturnValue(new Promise(() => {}));
  await click("Cancel");
  await reason();
  await click("Confirm request");
  await until(() => document.body.textContent!.includes("Submitting…"));
  expect(
    host.querySelector<HTMLButtonElement>('button[type="button"]')?.disabled,
  ).toBe(false);
  expect(
    [...document.querySelectorAll("button")].find(
      (entry) => entry.textContent === "Submitting…",
    )?.disabled,
  ).toBe(true);
  expect(document.querySelector("[role=dialog]")).not.toBeNull();
  await act(async () =>
    complete({
      success: true,
      data: { ...membership, gymId: "gym-id", status: "CANCELLED" },
    }),
  );
  await until(() => document.querySelector("[role=dialog]") === null);
  expect(host.textContent).toContain("Membership cancelled.");
  expect(host.textContent).toContain("Oak Gym");
  expect(host.textContent).not.toContain("Scan gym QR");
  expect(invalidate.mock.calls[0][0]).toMatchObject({
    queryKey: ["api"],
    predicate: expect.any(Function),
  });
  expect(
    mocks.request.mock.calls.filter(
      ([, options]) => options?.method === "POST",
    ),
  ).toHaveLength(1);
});
it("keeps a failed cancellation dialog open and preserves active membership access", async () => {
  mocks.request.mockImplementation((_path: string, options?: RequestInit) =>
    options?.method === "POST"
      ? Promise.reject(new Error("Please retry later"))
      : Promise.resolve({ success: true, data: [membership] }),
  );
  await render();
  await until(() => host.textContent!.includes("Oak Gym"));
  await click("Cancel");
  await reason();
  await click("Confirm request");
  await until(() => document.body.textContent!.includes("Please retry later"));
  expect(document.querySelector("[role=dialog]")).not.toBeNull();
  expect(host.textContent).toContain("Scan gym QR");
  expect(host.textContent).not.toContain("Membership cancelled.");
});
it("hides the freeze action after its allowance has been consumed", async () => {
  mocks.request.mockResolvedValue({
    success: true,
    data: [
      {
        ...membership,
        freezePeriods: [
          {
            startsAt: "2026-08-01T00:00:00.000Z",
            endsAt: "2026-08-06T00:00:00.000Z",
          },
        ],
      },
    ],
  });
  await render();
  await until(() => host.textContent!.includes("Oak Gym"));
  expect(
    [...host.querySelectorAll("button")].some(
      (entry) => entry.textContent === "Freeze",
    ),
  ).toBe(false);
});
it("lets a frozen member reactivate and refreshes access only after server confirmation", async () => {
  const frozen = { ...membership, status: "FROZEN" };
  mocks.request.mockImplementation((_path: string, options?: RequestInit) =>
    Promise.resolve({
      success: true,
      data: options?.method === "POST" ? membership : [frozen],
    }),
  );
  await render();
  await until(() => host.textContent!.includes("Reactivate"));
  vi.spyOn(client, "invalidateQueries").mockReturnValue(new Promise(() => {}));
  await click("Reactivate");
  await reason();
  await click("Confirm request");
  await until(() => host.textContent!.includes("Membership reactivated."));
  expect(mocks.request).toHaveBeenCalledWith(
    "/api/v1/users/me/subscriptions/monthly/reactivate",
    expect.objectContaining({ method: "POST" }),
  );
  expect(host.textContent).toContain("Scan gym QR");
  const options = vi.mocked(client.invalidateQueries).mock.calls.find(([value]) => Boolean(value?.predicate))?.[0];
  expect(options?.predicate?.({ queryKey:["api", "/api/v1/users/classes?day=&page=1", "user"] } as never)).toBe(true);
  expect(options?.predicate?.({ queryKey:["api", "/api/v1/workspace/records/bookings?limit=20&page=1", "user"] } as never)).toBe(true);
});
