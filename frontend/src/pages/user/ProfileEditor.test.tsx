// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ request: vi.fn(), saved: vi.fn() }));
vi.mock("../../services/apiClient", () => ({ apiRequest: mocks.request }));
vi.mock("./ProfileContactEditor", () => ({
  ProfileContactEditor: () => <p>Verified contacts</p>,
}));
vi.mock("../../components/MediaImageEditor", () => ({
  MediaImageEditor: ({ onChange }: any) => (
    <>
      <button
        type="button"
        onClick={() => onChange("507f1f77bcf86cd799439011", "/photo.webp")}
      >
        Choose S3 photo
      </button>
      <button type="button" onClick={() => onChange(null)}>
        Remove image
      </button>
    </>
  ),
}));
import { ProfileEditor } from "./ProfileEditor";
let root: Root, host: HTMLDivElement, client: QueryClient;
beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  client = new QueryClient();
  mocks.request.mockResolvedValue({ success: true, data: {} });
});
afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
  host.remove();
  vi.restoreAllMocks();
});
async function render(profile = {}) {
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <ProfileEditor
          user={{
            name: "Ada Member",
            avatarUrl: "/old.png",
            email: "ada@example.test",
            profile,
            social: { visibility: "PRIVATE", timezone: "Asia/Kolkata" },
          }}
          onSaved={mocks.saved}
        />
      </QueryClientProvider>,
    ),
  );
}
async function click(text: string) {
  await act(async () =>
    [...host.querySelectorAll("button")]
      .find((button) => button.textContent === text)!
      .click(),
  );
}
async function save() {
  await act(async () =>
    host
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
}
it("saves a completed S3 attachment reference without editable contact or arbitrary image URLs", async () => {
  await render();
  await click("Choose S3 photo");
  await save();
  const body = JSON.parse(mocks.request.mock.calls[0][1].body);
  expect(body).toMatchObject({
    name: "Ada Member",
    avatarAttachmentId: "507f1f77bcf86cd799439011",
    social: { visibility: "PRIVATE", timezone: "Asia/Kolkata" },
  });
  expect(body).not.toHaveProperty("email");
  expect(body).not.toHaveProperty("phone");
  expect(body).not.toHaveProperty("avatarUrl");
  expect(mocks.saved).toHaveBeenCalled();
});
it("persists removal as a null attachment reference", async () => {
  await render();
  await click("Remove image");
  await save();
  expect(
    JSON.parse(mocks.request.mock.calls[0][1].body).avatarAttachmentId,
  ).toBeNull();
});
it("groups fields and confirms cancelling before discarding staged profile changes", async () => {
  await render();
  expect([...host.querySelectorAll("legend")].map(node => node.textContent)).toEqual(["Profile photo", "Personal information", "Fitness information"]);
  expect(host.querySelector('[aria-label="Contact information"]')).not.toBeNull();
  await click("Choose S3 photo");
  expect(host.querySelector("form")?.dataset.unsavedChanges).toBe("true");
  const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
  await click("Cancel");
  expect(host.querySelector("form")?.dataset.unsavedChanges).toBe("true");
  await click("Cancel");
  expect(confirm).toHaveBeenCalledTimes(2);
  expect(host.querySelector("form")?.dataset.unsavedChanges).toBeUndefined();
  await save();
  expect(JSON.parse(mocks.request.mock.calls[0][1].body)).not.toHaveProperty("avatarAttachmentId");
});
it("clears unsaved navigation state after a successful save", async () => {
  await render();
  await click("Choose S3 photo");
  const before = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(before);
  expect(before.defaultPrevented).toBe(true);
  await save();
  expect(host.querySelector("form")?.dataset.unsavedChanges).toBeUndefined();
  const after = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(after);
  expect(after.defaultPrevented).toBe(false);
});
it("sends explicit removals when the user clears previously saved private fields", async () => {
  await render({
    gender: "FEMALE",
    dateOfBirth: "1990-01-01T00:00:00Z",
    heightCm: 165,
    weightKg: 60,
  });
  for (const name of ["gender", "dateOfBirth", "heightCm", "weightKg"])
    (
      host.querySelector(`[name="${name}"]`) as
        HTMLInputElement | HTMLSelectElement
    ).value = "";
  await save();
  expect(JSON.parse(mocks.request.mock.calls[0][1].body).profile).toMatchObject(
    { gender: null, dateOfBirth: null, heightCm: null, weightKg: null },
  );
});
