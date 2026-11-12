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

it("keeps pagination outside the member scroll region and resets scrolling on page and filter changes", async () => {
  network.request.mockReset();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  sessionStorage.clear();
  const name = "Asha Rao with a very long member name";
  const trainer = "Trainer with a long full name";
  const email = "a.long.email.address.for.the.member@example.com";
  const plan = "Annual strength and personal training membership";
  network.request.mockImplementation(async (path: string) => ({
    data: path.startsWith("/api/v1/owner/members?") ? [{
      publicId: "member-one", status: "ACTIVE", contact: { name, email, phone: "+919111111111" },
      assignedTrainerId: { name: trainer, phone: "+919222222222" },
      currentSubscriptionId: { status: "ACTIVE", planSnapshot: { name: plan } },
    }] : [],
    meta: { total: 80, pages: 8 },
  }));
  const host = document.createElement("div"), root = createRoot(host), client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  document.body.append(host);
  const waitForList = async () => {
    await act(async () => { await new Promise((resolve) => { setTimeout(resolve, 20); }); });
    return host.querySelector<HTMLDivElement>('[aria-label="Member list"]')!;
  };
  try {
    await act(async () => { root.render(<QueryClientProvider client={client}><MemoryRouter><OwnerMembersPage /></MemoryRouter></QueryClientProvider>); });
    let region = await waitForList();
    expect(region.tabIndex).toBe(0);
    expect(region.querySelector('[aria-label="Pagination"]')).toBeNull();
    expect(host.querySelector('[aria-label="Pagination"]')).not.toBeNull();
    for (const text of [name, trainer, email, plan])
      expect([...region.querySelectorAll("[title]")].some((node) => node.getAttribute("title") === text && node.textContent === text)).toBe(true);

    region.scrollTop = 320;
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Next page"]')!.click());
    region = await waitForList();
    expect(region.scrollTop).toBe(0);
    expect(host.querySelector('[aria-current="page"]')?.getAttribute("aria-label")).toBe("Page 2");
    region.scrollTop = 200;
    // Returning to a cached page must reset the same scroll container too.
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Previous page"]')!.click());
    region = await waitForList();
    expect(region.scrollTop).toBe(0);
    region.scrollTop = 180;
    await act(async () => {
      const select = host.querySelector<HTMLSelectElement>('[aria-label="Membership status"]')!;
      select.value = "ACTIVE";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect((await waitForList()).scrollTop).toBe(0);
    expect(network.request.mock.calls.some(([path]) => path.includes("membershipStatus=ACTIVE"))).toBe(true);
  } finally {
    await act(async () => root.unmount()); host.remove(); client.clear(); sessionStorage.clear();
  }
});

it("opens row actions outside the scroll region and dismisses them with Escape, outside interaction or scrolling", async () => {
  network.request.mockReset();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  sessionStorage.clear();
  context.permissions = ["gym:read", "member:read", "member:write", "finance:read"];
  network.request.mockImplementation(async (path: string) => ({
    data: path.startsWith("/api/v1/owner/members?") ? [{ publicId: "member-one", status: "ACTIVE", contact: { name: "Asha" } }] : [],
    meta: { total: 1 },
  }));
  const host = document.createElement("div"), root = createRoot(host), client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  document.body.append(host);
  const actions = () => document.querySelector('[aria-label="Actions for Asha"]');
  try {
    await act(async () => { root.render(<QueryClientProvider client={client}><MemoryRouter><OwnerMembersPage /></MemoryRouter></QueryClientProvider>); });
    await act(async () => { await new Promise((resolve) => { setTimeout(resolve, 20); }); });
    const trigger = host.querySelector<HTMLButtonElement>('[aria-label="More actions for Asha"]')!;
    await act(async () => trigger.click());
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(actions()?.parentElement).toBe(document.body);
    expect(actions()?.textContent).toContain("Assign trainer");
    expect(actions()?.querySelector('a[href="/owner/members/member-one#member-payments"]')).not.toBeNull();
    expect(document.activeElement).toBe(actions()?.querySelector("a"));
    await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(actions()).toBeNull();
    expect(document.activeElement).toBe(trigger);
    await act(async () => trigger.click());
    await act(async () => document.body.dispatchEvent(new Event("pointerdown", { bubbles: true })));
    expect(actions()).toBeNull();
    await act(async () => trigger.click());
    await act(async () => host.querySelector('[aria-label="Member list"]')!.dispatchEvent(new Event("scroll")));
    expect(actions()).toBeNull();
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  } finally {
    await act(async () => root.unmount()); host.remove(); client.clear(); sessionStorage.clear();
    context.permissions = ["gym:read", "member:read", "finance:read"];
  }
});
