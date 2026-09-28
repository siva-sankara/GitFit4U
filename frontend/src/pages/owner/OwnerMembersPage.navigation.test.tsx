// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { expect, it, vi } from "vitest";
import { navigationSessionKey, navigationSessionScope } from "../../services/navigationSession";
const context = vi.hoisted(() => ({ userId: "owner-a", gymId: "gym-a", sessionId: "session-a", permissions: ["gym:read", "member:read"] }));
const request = vi.hoisted(() => vi.fn());
vi.mock("../../api/hooks", () => ({ useCurrentUser: () => ({ data: { data: { context } } }) }));
vi.mock("../../services/apiClient", () => ({ apiRequest: request }));
import { OwnerMembersPage } from "./OwnerMembersPage";

it("restores actual member-list search, membership/plan/trainer filters and page in its first API request", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  sessionStorage.clear();
  sessionStorage.setItem(navigationSessionKey(navigationSessionScope(context)!, "member-list"), JSON.stringify({ page: 3, search: "Taylor", status: "FROZEN", planId: "plan-a", trainerId: "trainer-a" }));
  request.mockImplementation(async (path: string) => ({ data: path.includes("/plans") ? [{ publicId: "plan-a", name: "Strength" }] : path.includes("/trainers") ? [{ _id: "trainer-a", name: "Trainer A" }] : [], meta: { pages: 5, total: 100 } }));
  const host = document.createElement("div"), root = createRoot(host), client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  document.body.append(host);
  try {
    await act(async () => { root.render(<QueryClientProvider client={client}><MemoryRouter><OwnerMembersPage /></MemoryRouter></QueryClientProvider>); });
    await act(async () => { await new Promise(resolve => { setTimeout(resolve, 20); }); });
    expect(host.querySelector<HTMLInputElement>('[placeholder="Search name, phone or member code"]')?.value).toBe("Taylor");
    expect(host.querySelector<HTMLSelectElement>('[aria-label="Membership status"]')?.value).toBe("FROZEN");
    expect(host.querySelector<HTMLSelectElement>('[aria-label="Membership plan"]')?.value).toBe("plan-a");
    expect(host.querySelector<HTMLSelectElement>('[aria-label="Assigned trainer"]')?.value).toBe("trainer-a");
    expect(host.textContent).toContain("Page 3");
    const path = request.mock.calls.find(([url]) => url.startsWith("/api/v1/owner/members?"))?.[0];
    const query = new URL(path, "https://fitness.example").searchParams;
    expect(Object.fromEntries(query)).toMatchObject({ page: "3", q: "Taylor", membershipStatus: "FROZEN", planId: "plan-a", trainerId: "trainer-a" });
  } finally { await act(async () => root.unmount()); host.remove(); client.clear(); sessionStorage.clear(); }
});
