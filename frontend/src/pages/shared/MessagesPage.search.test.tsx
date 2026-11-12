// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("../../services/apiClient", () => ({ apiRequest: mocks.request }));
vi.mock("../../services/mediaUpload", () => ({ uploadMedia: vi.fn() }));
vi.mock("../../api/hooks", () => ({
  useCurrentUser: () => ({ data: { data: {
    user: { _id: "me" }, context: { role: "GYM_OWNER", gymId: "gym-one", permissions: ["member:read"] },
  } } }),
}));
import { MessagesPage } from "./MessagesPage";

const alice = { _id: "111111111111111111111111", publicId: "alice", name: "Alice Sharma", phone: "+919876543210", email: "alice@example.test" };
const bob = { _id: "222222222222222222222222", publicId: "bob", name: "Bob Kumar", phone: "+919876543211" };
const thread = { publicId: "existing-thread", type: "DIRECT", participants: [{ _id: "me", name: "Owner" }, alice], archivedBy: [] };
const envelope = (data: unknown, pages = 1) => ({ success: true, data, meta: { pages } });
let host: HTMLDivElement, root: Root, client: QueryClient;

function defaultRequest(path: string, options?: RequestInit) {
  if (path.startsWith("/api/v1/conversations/contacts?")) {
    const query = new URL(path, "http://localhost").searchParams.get("q") || "";
    return Promise.resolve(envelope(query === "Bob" ? [bob] : [alice]));
  }
  if (path === "/api/v1/conversations" && options?.method === "POST") return Promise.resolve(envelope(thread));
  if (path.includes("conversations?page=")) return Promise.resolve(envelope([thread]));
  if (path.endsWith("/messages")) return Promise.resolve(envelope([]));
  return Promise.resolve(envelope(thread));
}
const contactRequests = () => mocks.request.mock.calls.filter(([path]) => path.startsWith("/api/v1/conversations/contacts?"));
const createRequests = () => mocks.request.mock.calls.filter(([path, options]) => path === "/api/v1/conversations" && options?.method === "POST");
async function flush(ms = 30) { await act(async () => { await new Promise(resolve => { setTimeout(resolve, ms); }); }); }
async function mount(supportOnly = false) {
  await act(async () => root.render(<QueryClientProvider client={client}><MemoryRouter initialEntries={["/messages"]}><MessagesPage supportOnly={supportOnly} /></MemoryRouter></QueryClientProvider>));
  await flush();
}
async function type(value: string, settle = true) {
  await act(async () => {
    const input = host.querySelector<HTMLInputElement>('input[type="search"]')!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  if (settle) { await flush(350); await flush(); }
}
const messageButton = () => host.querySelector<HTMLButtonElement>('.chat-contact-result button')!;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  mocks.request.mockImplementation(defaultRequest);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); host.remove(); });

it("searches from the main input and opens the chosen contact only after Message is clicked", async () => {
  await mount();
  expect(contactRequests()).toHaveLength(0);
  await type("A");
  expect(contactRequests()).toHaveLength(0);
  await type("Alice");
  expect(contactRequests().at(-1)?.[0]).toContain("q=Alice&page=1&limit=10");
  expect(host.querySelector('[aria-label="Matching contacts"]')?.textContent).toContain(alice.phone);
  expect(host.querySelector('[aria-label="Matching contacts"]')?.textContent).toContain(alice.email);
  expect(createRequests()).toHaveLength(0);
  await act(async () => messageButton().click());
  await flush();
  expect(JSON.parse(createRequests()[0][1].body)).toEqual({ type: "DIRECT", participantIds: [alice._id] });
  expect(host.querySelector(".chat-heading strong")?.textContent).toBe(alice.name);
  expect(host.querySelector<HTMLInputElement>('input[type="search"]')!.value).toBe("");
  expect(mocks.request.mock.calls.some(([path, options]) => path.endsWith("/messages") && options?.method === "POST")).toBe(false);
});

it("accepts formatted phone numbers and retains conversations matched by the server", async () => {
  await mount();
  await type("+91 98765-43210");
  expect(contactRequests().at(-1)?.[0]).toContain("q=%2B919876543210");
  expect(host.querySelector(".conversation")?.textContent).toContain(alice.name);
  expect(messageButton().getAttribute("aria-label")).toBe(`Message ${alice.name} at ${alice.phone}`);
});

it("hides stale contacts immediately and resets contact pagination for a new search", async () => {
  mocks.request.mockImplementation((path: string, options?: RequestInit) => path.includes("/contacts?q=Alice")
    ? Promise.resolve(envelope([alice], 2)) : defaultRequest(path, options));
  await mount();
  await type("Alice");
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Next contacts"]')!.click());
  await flush();
  expect(contactRequests().at(-1)?.[0]).toContain("page=2");
  await type("Bob", false);
  expect(host.querySelector(".chat-contact-result")).toBeNull();
  await flush(350); await flush();
  expect(contactRequests().at(-1)?.[0]).toContain("q=Bob&page=1");
  expect(host.querySelector(".chat-contact-result")?.textContent).toContain(bob.name);
  expect(host.querySelector(".chat-contact-result")?.textContent).not.toContain(alice.name);
});

it("shows failed lookups with Retry and prevents duplicate opens while a request is pending", async () => {
  let failLookup = true;
  let resolveOpen!: (value: unknown) => void;
  const opening = new Promise(resolve => { resolveOpen = resolve; });
  mocks.request.mockImplementation((path: string, options?: RequestInit) => {
    if (path.includes("/contacts?") && failLookup) return Promise.reject(new Error("Contact search unavailable."));
    if (path === "/api/v1/conversations" && options?.method === "POST") return opening;
    return defaultRequest(path, options);
  });
  await mount(); await type("Alice");
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("Contact search unavailable.");
  failLookup = false;
  await act(async () => [...host.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "Retry contact search")!.click());
  await flush();
  await act(async () => messageButton().click());
  await flush();
  expect(messageButton().disabled).toBe(true);
  await act(async () => messageButton().click());
  expect(createRequests()).toHaveLength(1);
  await act(async () => resolveOpen(envelope(thread))); await flush();
});

it("keeps the support request form and excludes contact lookup on the support route", async () => {
  await mount(true);
  await type("Alice");
  expect(contactRequests()).toHaveLength(0);
  expect(host.querySelector(".chat-start summary")?.textContent).toBe("Start a support conversation");
  expect(host.querySelector('[aria-label="Matching contacts"]')).toBeNull();
});
