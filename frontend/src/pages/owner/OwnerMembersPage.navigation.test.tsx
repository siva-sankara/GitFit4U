// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { expect, it, vi } from "vitest";
import { navigationSessionKey, navigationSessionScope } from "../../services/navigationSession";
const context = vi.hoisted(() => ({ userId: "owner-a", gymId: "gym-a", sessionId: "session-a", permissions: ["gym:read", "member:read", "finance:read"] }));
const network = vi.hoisted(() => ({ request: vi.fn(), download: vi.fn() }));
vi.mock("../../api/hooks", () => ({ useCurrentUser: () => ({ data: { data: { context } } }) }));
vi.mock("../../services/apiClient", () => ({ apiRequest: network.request, apiFileDownload: network.download }));
import { OwnerMembersPage } from "./OwnerMembersPage";

it("restores member-list search, filters, sort and page in its first API request", async () => {
  const request = network.request;
  request.mockReset();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  sessionStorage.clear();
  sessionStorage.setItem(navigationSessionKey(navigationSessionScope(context)!, "member-list"), JSON.stringify({ page: 3, search: "Taylor", status: "FROZEN", planId: "plan-a", trainerId: "trainer-a", paymentStatus: "DUE", sort: "NAME_ASC" }));
  request.mockImplementation(async (path: string) => ({ data: path.includes("/plans") ? [{ publicId: "plan-a", name: "Strength" }] : path.includes("/trainers") ? [{ _id: "trainer-a", name: "Trainer A" }] : [], meta: { pages: 5, total: 100, summary: { total: 100, active: 70, pendingActivation: 4, paymentDue: 8 } } }));
  const host = document.createElement("div"), root = createRoot(host), client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  document.body.append(host);
  try {
    await act(async () => { root.render(<QueryClientProvider client={client}><MemoryRouter><OwnerMembersPage /></MemoryRouter></QueryClientProvider>); });
    await act(async () => { await new Promise(resolve => { setTimeout(resolve, 20); }); });
    expect(host.querySelector<HTMLInputElement>('[placeholder="Search members by name, phone, email or ID…"]')?.value).toBe("Taylor");
    expect(host.querySelector<HTMLSelectElement>('[aria-label="Membership status"]')?.value).toBe("FROZEN");
    expect(host.querySelector<HTMLSelectElement>('[aria-label="Membership plan"]')?.value).toBe("plan-a");
    expect(host.querySelector<HTMLSelectElement>('[aria-label="Assigned trainer"]')?.value).toBe("trainer-a");
    expect(host.querySelector<HTMLSelectElement>('[aria-label="Payment status"]')?.value).toBe("DUE");
    expect(host.querySelector<HTMLSelectElement>('[aria-label="Sort members"]')?.value).toBe("NAME_ASC");
    expect(host.textContent).toContain("Active Members70");
    expect(host.textContent).toContain("Page 3");
    const path = request.mock.calls.find(([url]) => url.startsWith("/api/v1/owner/members?"))?.[0];
    const query = new URL(path, "https://fitness.example").searchParams;
    expect(Object.fromEntries(query)).toMatchObject({ page: "3", q: "Taylor", membershipStatus: "FROZEN", planId: "plan-a", trainerId: "trainer-a", paymentStatus: "DUE", sort: "NAME_ASC" });
  } finally { await act(async () => root.unmount()); host.remove(); client.clear(); sessionStorage.clear(); }
});

it("selects only visible members and exports their exact public IDs", async () => {
  const request = network.request;
  request.mockReset();
  network.download.mockReset();
  sessionStorage.clear();
  context.permissions = ["gym:read", "member:read", "member:write", "finance:read"];
  const members = [
    { publicId: "member-one", status: "ACTIVE", joinedAt: "2026-10-01T00:00:00.000Z", contact: { name: "Asha", phone: "+919111111111" } },
    { publicId: "member-two", status: "ACTIVE", joinedAt: "2026-10-02T00:00:00.000Z", contact: { name: "Bala", phone: "+919222222222" } },
  ];
  request.mockImplementation(async (path: string) => ({
    data: path.startsWith("/api/v1/owner/members?") ? members : [],
    meta: path.startsWith("/api/v1/owner/members?")
      ? { pages: 4, total: 32, summary: { total: 32, active: 20, pendingActivation: 2, paymentDue: 3 } }
      : { pages: 1, total: 0 },
  }));
  network.download.mockResolvedValue(new Blob(["workbook"]));
  URL.createObjectURL = vi.fn(() => "blob:members");
  URL.revokeObjectURL = vi.fn();
  const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
  const host = document.createElement("div"), root = createRoot(host), client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  document.body.append(host);
  try {
    await act(async () => { root.render(<QueryClientProvider client={client}><MemoryRouter><OwnerMembersPage /></MemoryRouter></QueryClientProvider>); });
    for (let i = 0; i < 40 && !host.querySelector('[aria-label="Select all members on this page"]'); i++)
      await act(async () => { await new Promise((resolve) => { setTimeout(resolve, 10); }); });
    await act(async () => host.querySelector<HTMLInputElement>('[aria-label="Select all members on this page"]')!.click());
    expect(host.textContent).toContain("2 selected");
    await act(async () => [...host.querySelectorAll("button")].find((button) => button.textContent?.includes("Download selected"))!.click());
    expect(network.download).toHaveBeenCalledOnce();
    const [path, options] = network.download.mock.calls[0];
    expect(path).toBe("/api/v1/owner/members/export");
    expect(JSON.parse(options.body)).toMatchObject({
      memberIds: ["member-one", "member-two"],
      format: "xlsx",
      scope: "selected",
    });
  } finally {
    click.mockRestore();
    await act(async () => root.unmount());
    host.remove();
    client.clear();
    sessionStorage.clear();
    context.permissions = ["gym:read", "member:read", "finance:read"];
  }
});
