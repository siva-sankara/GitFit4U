// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  permissions: ["member:read"],
}));
vi.mock("../../services/apiClient", () => ({ apiRequest: mocks.request }));
vi.mock("../../api/hooks", () => ({
  useCurrentUser: () => ({
    data: { data: { context: { permissions: mocks.permissions } } },
  }),
}));
import { OwnerMemberDetailsPage } from "./OwnerMemberDetailsPage";
let host: HTMLDivElement, root: Root, client: QueryClient;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  mocks.permissions = ["member:read"];
  mocks.request.mockImplementation(async (path: string) => ({
    data:
      path === "/api/v1/owner/trainers"
        ? []
        : {
            timezone: "Asia/Kolkata",
            member: {
              publicId: "member",
              memberCode: "M001",
              userId: { name: "Member One" },
              status: "ACTIVE",
              assignedTrainerId: {
                _id: "trainer",
                name: "Trainer One",
                phone: "+919876543210",
                email: "trainer@example.test",
                specializations: ["Strength"],
                status: "ACTIVE",
              },
              trainerAssignedAt: "2026-09-26T20:00:00Z",
            },
            payments: [],
            attendance: [],
          },
  }));
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
async function render() {
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <OwnerMemberDetailsPage id="member" />
        </MemoryRouter>
      </QueryClientProvider>,
    ),
  );
  for (let i = 0; i < 5; i++)
    await act(async () => {
      await new Promise((resolve) => { setTimeout(resolve, 15); });
    });
}
it("shows actual assigned-trainer details without fetching unauthorized options or displaying hidden finances", async () => {
  await render();
  expect(host.textContent).toContain("Trainer One");
  expect(host.textContent).toContain("trainer@example.test");
  expect(host.textContent).toContain("27 Sept 2026");
  expect(host.textContent).not.toContain("Payment history");
  expect(
    mocks.request.mock.calls.some(
      ([path]) => path === "/api/v1/owner/trainers",
    ),
  ).toBe(false);
});
it("loads editable trainer choices and payment history only with their respective permissions", async () => {
  mocks.permissions = [
    "member:read",
    "member:write",
    "gym:read",
    "finance:read",
  ];
  await render();
  expect(host.textContent).toContain("Payment history");
  expect(
    mocks.request.mock.calls.some(
      ([path]) => path === "/api/v1/owner/trainers",
    ),
  ).toBe(true);
});
