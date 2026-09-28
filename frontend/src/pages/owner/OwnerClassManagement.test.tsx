// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("../../services/apiClient", async () => {
  const actual = await vi.importActual<any>("../../services/apiClient");
  return { ...actual, apiRequest: mocks.request };
});
import { ClassEditor } from "./OwnerClassManagement";
let host: HTMLDivElement, root: Root, client: QueryClient;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  mocks.request.mockResolvedValue({ success: true, data: [] });
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
  const saved = vi.fn();
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <ClassEditor onSaved={saved} onClose={vi.fn()} />
      </QueryClientProvider>,
    ),
  );
  return saved;
}
it("creates a complete typed class payload with blank optional values normalized and a real API call", async () => {
  const saved = await render();
  const dialog = document.querySelector('[role="dialog"]')!;
  (dialog.querySelector('[name="name"]') as HTMLInputElement).value =
    "Morning strength";
  await act(async () =>
    dialog
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  const submitted = mocks.request.mock.calls.find(
    ([path]) => path === "/api/v1/owner/classes",
  );
  expect(submitted).toBeTruthy();
  expect(JSON.parse(submitted![1].body)).toMatchObject({
    name: "Morning strength",
    category: "OTHER",
    trainerId: null,
    capacity: 10,
    room: "",
    description: "",
    status: "SCHEDULED",
  });
  expect(submitted![1].idempotencyKey).toBeTruthy();
  expect(saved).toHaveBeenCalled();
  expect(host.querySelector('[role="dialog"]')).toBeNull();
});
it("displays a field-specific backwards-time error and does not submit invalid class data", async () => {
  await render();
  const dialog = document.querySelector('[role="dialog"]')!;
  (dialog.querySelector('[name="endsAt"]') as HTMLInputElement).value =
    "2020-01-01T08:00";
  await act(async () =>
    dialog
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  expect(dialog.textContent).toContain(
    "End time must be later than start time.",
  );
  expect(
    dialog.querySelector('[name="endsAt"]')?.getAttribute("aria-invalid"),
  ).toBe("true");
  expect(
    mocks.request.mock.calls.some(([path]) => path === "/api/v1/owner/classes"),
  ).toBe(false);
});
it("removes a class image with an explicit null while preserving typed class details", async () => {
  await act(async () => root.render(<QueryClientProvider client={client}><ClassEditor value={{
    publicId: "yoga", name: "Morning yoga", category: "YOGA", startsAt: "2099-01-01T10:00:00Z", endsAt: "2099-01-01T11:00:00Z", capacity: 10, status: "SCHEDULED", imageAttachmentId: "507f1f77bcf86cd799439011", imageUrl: "https://media.test/yoga.webp",
  }} onSaved={vi.fn()} onClose={vi.fn()} /></QueryClientProvider>));
  const dialog = document.querySelector('[role="dialog"]')!;
  expect(dialog.querySelector('img[alt="Class image preview"]')).not.toBeNull();
  await act(async () => Array.from(dialog.querySelectorAll("button")).find(button => button.textContent === "Remove image")!.click());
  await act(async () => dialog.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  const submitted = mocks.request.mock.calls.find(([path]) => path === "/api/v1/workspace/classes/yoga");
  expect(JSON.parse(submitted![1].body)).toMatchObject({ imageAttachmentId: null, name: "Morning yoga", capacity: 10 });
});
