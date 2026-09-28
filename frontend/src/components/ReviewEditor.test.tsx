// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  upload: vi.fn(),
  saved: vi.fn(),
  busy: vi.fn(),
}));
vi.mock("../services/apiClient", () => ({ apiRequest: mocks.request }));
vi.mock("../services/mediaUpload", () => ({ uploadMedia: mocks.upload }));
import { ReviewEditor } from "./ReviewEditor";

const oldId = "507f1f77bcf86cd799439011",
  newId = "507f1f77bcf86cd799439012";
let host: HTMLDivElement, root: Root, client: QueryClient;
const objectUrl = URL.createObjectURL,
  revokeUrl = URL.revokeObjectURL;
beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  URL.createObjectURL = vi.fn(() => "blob:review-preview");
  URL.revokeObjectURL = vi.fn();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  mocks.request.mockResolvedValue({ success: true, data: {} });
  mocks.upload.mockResolvedValue({ _id: newId, url: "/uploaded-review.png" });
});
afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
  host.remove();
  URL.createObjectURL = objectUrl;
  URL.revokeObjectURL = revokeUrl;
});
async function render(initial: Record<string, any> = {}) {
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <ReviewEditor
          gymId="gym-public"
          initial={initial}
          onSaved={mocks.saved}
          onBusyChange={mocks.busy}
        />
      </QueryClientProvider>,
    ),
  );
  (host.querySelector('[name="body"]') as HTMLTextAreaElement).value =
    "  Helpful gym staff  ";
}
async function submit() {
  await act(async () =>
    host
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
}
async function click(text: string) {
  const button = [...host.querySelectorAll<HTMLButtonElement>("button")].find(
    (item) => item.textContent === text,
  );
  expect(button).toBeTruthy();
  await act(async () => button!.click());
}
async function choosePhoto() {
  const file = new File([new Uint8Array([137, 80, 78, 71])], "review.png", {
    type: "image/png",
  });
  const input = host.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(input, "files", { configurable: true, value: [file] });
  await act(async () =>
    input.dispatchEvent(new Event("change", { bubbles: true })),
  );
  return file;
}
function sentBody() {
  return JSON.parse(mocks.request.mock.calls.at(-1)![1].body);
}

it("creates a review using the completed REVIEW upload reference and gym ID", async () => {
  await render();
  const file = await choosePhoto();
  await submit();
  expect(mocks.upload.mock.calls[0][0]).toBe(file);
  expect(mocks.upload.mock.calls[0][1]).toBe("REVIEW");
  expect(mocks.request).toHaveBeenCalledWith(
    "/api/v1/users/me/reviews",
    expect.objectContaining({ method: "POST" }),
  );
  expect(sentBody()).toMatchObject({
    gymId: "gym-public",
    rating: 5,
    body: "Helpful gym staff",
    attachmentIds: [newId],
    removeLegacyPhotos: false,
  });
  expect(sentBody()).not.toHaveProperty("photoUrls");
  expect(mocks.saved).toHaveBeenCalledOnce();
});
it("edits without resending gymId and preserves existing image bindings and legacy photos by default", async () => {
  await render({
    publicId: "review-existing",
    rating: 4,
    images: [{ id: oldId, url: "/old-review.png" }],
    photoUrls: ["https://legacy.invalid/review.png"],
  });
  await submit();
  expect(mocks.request).toHaveBeenCalledWith(
    "/api/v1/users/me/reviews/review-existing",
    expect.objectContaining({ method: "PATCH" }),
  );
  expect(sentBody()).toMatchObject({
    attachmentIds: [oldId],
    removeLegacyPhotos: false,
  });
  expect(sentBody()).not.toHaveProperty("gymId");
  expect(sentBody()).not.toHaveProperty("photoUrls");
});
it("replaces an existing image binding and removes legacy photos only when explicitly selected", async () => {
  await render({
    publicId: "review-existing",
    images: [{ id: oldId, url: "/old-review.png" }],
    photoUrls: ["https://legacy.invalid/review.png"],
  });
  await click("Remove photo 1");
  await choosePhoto();
  await act(async () =>
    host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click(),
  );
  await submit();
  expect(sentBody()).toMatchObject({
    attachmentIds: [newId],
    removeLegacyPhotos: true,
  });
  expect(sentBody()).not.toHaveProperty("gymId");
});
it("blocks button and programmatic submission while the image upload is pending", async () => {
  let finish!: (value: any) => void;
  mocks.upload.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  await render();
  await choosePhoto();
  expect(
    host.querySelector<HTMLButtonElement>("button.btn-primary")!.disabled,
  ).toBe(true);
  expect(mocks.busy).toHaveBeenLastCalledWith(true);
  await submit();
  expect(mocks.request).not.toHaveBeenCalled();
  await act(async () => finish({ _id: newId, url: "/uploaded-review.png" }));
  expect(
    host.querySelector<HTMLButtonElement>("button.btn-primary")!.disabled,
  ).toBe(false);
  await submit();
  expect(sentBody().attachmentIds).toEqual([newId]);
});
it("shows actionable API failure without reporting success", async () => {
  mocks.request.mockRejectedValue(
    new Error(
      "Choose completed review image uploads belonging to this account.",
    ),
  );
  await render();
  await submit();
  await act(async () => {
    await new Promise((resolve) => {
      setTimeout(resolve, 20);
    });
  });
  expect(host.querySelector('[role="alert"]')?.textContent).toContain(
    "Choose completed review image uploads",
  );
  expect(mocks.saved).not.toHaveBeenCalled();
});
it("finishing the eighth image releases upload busy state and allows saving", async () => {
  const images = Array.from({ length: 7 }, (_, index) => ({
    id: (index + 1).toString(16).padStart(24, "0"),
    url: `/photo-${index}.png`,
  }));
  await render({ publicId: "review-existing", images });
  await choosePhoto();
  expect(host.querySelectorAll(".review-photo-grid figure")).toHaveLength(8);
  expect(
    host.querySelector<HTMLButtonElement>("button.btn-primary")!.disabled,
  ).toBe(false);
  expect(mocks.busy).toHaveBeenLastCalledWith(false);
  await submit();
  expect(sentBody().attachmentIds).toEqual([
    ...images.map((image) => image.id),
    newId,
  ]);
});
