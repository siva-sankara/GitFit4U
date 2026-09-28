// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ request: vi.fn(), upload: vi.fn() }));
vi.mock("../../services/apiClient", () => ({ apiRequest: mocks.request }));
vi.mock("../../services/mediaUpload", () => ({ uploadMedia: mocks.upload }));
vi.mock("../../api/hooks", () => ({ useCurrentUser: () => ({ data: { data: { user: { _id: "me" }, context: { role: "USER" } } } }) }));
import { MessagesPage } from "./MessagesPage";
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
let host: HTMLDivElement, root: Root, client: QueryClient;
const conversations = ["a", "b"].map((id) => ({ publicId: id, title: `Chat ${id.toUpperCase()}`, participants: [{ _id: "me", name: "Me" }], archivedBy: [] }));
function envelope(data: unknown) { return { success: true, data }; }
function message(id: string, text: string) { return { publicId: id, text, senderId: { _id: "other", name: "Other" }, createdAt: "2026-09-27T10:00:00Z" }; }
function defaultRequest(path: string) {
  if (path.includes("/workspace/contacts")) return Promise.resolve(envelope([]));
  if (path.includes("conversations?page=")) return Promise.resolve({ ...envelope(conversations), meta: { pages: 1 } });
  const id = path.split("/conversations/")[1]?.split(/[/?]/)[0];
  if (path.endsWith("/messages")) return Promise.resolve({ ...envelope([message(`${id}-new`, `${id} recent message`)]), meta: { hasMore: true, nextCursor: `cursor-${id}` } });
  if (path.endsWith("/read")) return Promise.resolve(envelope({}));
  return Promise.resolve(envelope(conversations.find((row) => row.publicId === id)));
}
async function flush() { await act(async () => { await new Promise((resolve) => { setTimeout(resolve, 20); }); }); }
async function choose(id: string) {
  await act(async () => [...host.querySelectorAll<HTMLButtonElement>(".conversation")].find((button) => button.textContent?.includes(`Chat ${id.toUpperCase()}`))!.click());
  await flush();
}
async function type(text: string) {
  await act(async () => {
    const textarea = host.querySelector<HTMLTextAreaElement>('textarea[aria-label="Message"]')!;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(textarea, text);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  mocks.request.mockImplementation(defaultRequest);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { callback(0); return 1; });
  Object.defineProperty(HTMLElement.prototype, "scrollTo", { configurable: true, value: vi.fn() });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  await act(async () => root.render(<QueryClientProvider client={client}><MemoryRouter initialEntries={["/messages?conversation=a"]}><MessagesPage /></MemoryRouter></QueryClientProvider>));
  await flush();
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); host.remove(); vi.unstubAllGlobals(); });
it.each([false, true])("does not attach a late upload to a different selection (return to original=%s)", async (returnToOriginal) => {
  const upload = deferred<any>(); mocks.upload.mockReturnValue(upload.promise);
  await act(async () => {
    const input = host.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, "files", { value: [new File(["private"], "private-a.pdf", { type: "application/pdf" })] });
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await choose("b");
  if (returnToOriginal) await choose("a");
  await act(async () => upload.resolve({ publicId: "upload-a", originalName: "private-a.pdf" }));
  await flush();
  expect(host.querySelector(".chat-drafts")).toBeNull();
  expect(host.textContent).not.toContain("private-a.pdf");
});
it("discards a prior thread's late history response and cursor after selection changes", async () => {
  const history = deferred<any>();
  mocks.request.mockImplementation((path: string) => path.includes("/a/messages?before=") ? history.promise : defaultRequest(path));
  await act(async () => host.querySelector<HTMLButtonElement>(".chat-load")!.click());
  await choose("b");
  await act(async () => history.resolve({ ...envelope([message("private-a", "Private A history")]), meta: { nextCursor: "" } }));
  await flush();
  expect(host.textContent).not.toContain("Private A history");
  expect(host.textContent).toContain("b recent message");
  expect(host.querySelector(".chat-load")).not.toBeNull();
});
it("keeps a new draft after sending, switching away, and returning before the old send completes", async () => {
  const sent = deferred<any>();
  mocks.request.mockImplementation((path: string, options?: { method?: string }) => path === "/api/v1/conversations/a/messages" && options?.method === "POST" ? sent.promise : defaultRequest(path));
  await type("First A message");
  await act(async () => host.querySelector<HTMLFormElement>(".message-composer")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  const first = mocks.request.mock.calls.find(([path, options]) => path === "/api/v1/conversations/a/messages" && options?.method === "POST")!;
  expect(JSON.parse(first[1].body).text).toBe("First A message");
  await choose("b"); await choose("a"); await type("New unsent draft");
  await act(async () => sent.resolve(envelope({})));
  await flush();
  expect(host.querySelector<HTMLTextAreaElement>('textarea[aria-label="Message"]')!.value).toBe("New unsent draft");
  expect(host.querySelector<HTMLButtonElement>('[aria-label="Send message"]')!.disabled).toBe(false);
});
