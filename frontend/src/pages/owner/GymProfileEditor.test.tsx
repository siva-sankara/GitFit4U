// @vitest-environment jsdom
import { MemoryRouter } from "react-router-dom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ request: vi.fn(), upload: vi.fn() }));
vi.mock("../../services/apiClient", () => ({ apiRequest: mocks.request }));
vi.mock("../../services/documentUpload", () => ({
  uploadDocumentBytes: mocks.upload,
}));
vi.mock("../../components/LocationPicker", () => ({
  LocationPicker: ({ onChange }: any) => (
    <button
      type="button"
      onClick={() =>
        onChange({
          latitude: 17.45,
          longitude: 78.45,
          address: { city: "Hyderabad" },
        })
      }
    >
      Detect entrance
    </button>
  ),
}));
import {
  GymMediaEditor,
  GymProfilePlans,
  GymHoursEditor,
  GymLocationEditor,
} from "./GymProfileEditor";
import { GymLogoEditor } from "./GymLogoEditor";
let host: HTMLDivElement, root: Root, client: QueryClient;
beforeEach(() => {
  vi.resetAllMocks();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  mocks.request.mockImplementation(async (path: string) =>
    path === "/api/v1/uploads"
      ? {
          data: {
            uploadUrl: "https://storage.test/upload",
            attachment: { publicId: "upload-one" },
          },
        }
      : path.endsWith("/complete")
        ? { data: { _id: "attachment-one" } }
        : { data: {} },
  );
  mocks.upload.mockResolvedValue(undefined);
});
afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
  host.remove();
});
async function render(element: React.ReactNode) {
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>{element}</QueryClientProvider>,
    ),
  );
}
async function until(check: () => boolean) {
  for (let i = 0; i < 80 && !check(); i++)
    await act(async () => {
      await new Promise((r) => { setTimeout(r, 15); });
    });
  expect(check()).toBe(true);
}
function button(text: string) {
  return Array.from(host.querySelectorAll("button")).find(
    (b) => b.textContent === text,
  )!;
}
async function choose(file: File) {
  await act(async () => {
    const input = host.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, "files", {
      configurable: true,
      value: [file],
    });
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
it("uploads bytes and confirms storage before linking a photo to the gym", async () => {
  await render(
    <GymMediaEditor gym={{ mediaAttachmentIds: ["existing"], media: [] }} />,
  );
  await choose(new File(["photo"], "gym.jpg", { type: "image/jpeg" }));
  await act(async () => button("Upload and add to profile").click());
  await until(() => host.textContent!.includes("Media added"));
  expect(mocks.upload).toHaveBeenCalledOnce();
  expect(mocks.request.mock.calls.map((c) => c[0])).toEqual([
    "/api/v1/uploads",
    "/api/v1/uploads/upload-one/complete",
    "/api/v1/owner/gym",
  ]);
  expect(JSON.parse(mocks.request.mock.calls[2][1].body)).toEqual({
    mediaAttachmentIds: ["existing", "attachment-one"],
  });
});
it("previews and replaces a logo using the completed attachment ID", async () => {
  URL.createObjectURL = vi.fn(() => "blob:logo-preview");
  URL.revokeObjectURL = vi.fn();
  await render(
    <GymLogoEditor
      gym={{ name: "Test Gym", logoUrl: "https://storage.test/old-logo" }}
    />,
  );
  await choose(new File(["logo"], "logo.png", { type: "image/png" }));
  expect(host.querySelector("img")?.getAttribute("src")).toBe(
    "blob:logo-preview",
  );
  await act(async () => button("Save logo").click());
  await until(() => host.textContent!.includes("Gym logo saved."));
  expect(JSON.parse(mocks.request.mock.calls[0][1].body).purpose).toBe(
    "GYM_LOGO",
  );
  expect(mocks.request).toHaveBeenCalledWith("/api/v1/owner/gym", {
    method: "PATCH",
    body: JSON.stringify({ logoAttachmentId: "attachment-one" }),
  });
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:logo-preview");
});
it("removes the gym logo reference without deleting unrelated files", async () => {
  await render(
    <GymLogoEditor
      gym={{ name: "Test Gym", logoUrl: "https://storage.test/current-logo" }}
    />,
  );
  await act(async () => button("Remove logo").click());
  await until(() => host.textContent!.includes("Gym logo saved."));
  expect(mocks.request).toHaveBeenCalledWith("/api/v1/owner/gym", {
    method: "PATCH",
    body: JSON.stringify({ logoAttachmentId: null }),
  });
  expect(mocks.upload).not.toHaveBeenCalled();
});
it("retains the selected video after a cloud failure and retries", async () => {
  mocks.upload.mockRejectedValueOnce(new Error("Cloud access denied"));
  await render(<GymMediaEditor gym={{ mediaAttachmentIds: [], media: [] }} />);
  await choose(new File(["video"], "tour.mp4", { type: "video/mp4" }));
  await act(async () => button("Upload and add to profile").click());
  await until(() => host.textContent!.includes("Cloud access denied"));
  expect(
    mocks.request.mock.calls.some((c) => c[0] === "/api/v1/owner/gym"),
  ).toBe(false);
  await act(async () => button("Upload and add to profile").click());
  await until(() => host.textContent!.includes("Media added"));
});
it("retries profile linking without uploading a completed file twice", async () => {
  const original = mocks.request.getMockImplementation()!;
  let fail = true;
  mocks.request.mockImplementation((path, ...rest) =>
    path === "/api/v1/owner/gym" && fail
      ? ((fail = false), Promise.reject(new Error("Save unavailable")))
      : original(path, ...rest),
  );
  await render(<GymMediaEditor gym={{ mediaAttachmentIds: [], media: [] }} />);
  await choose(new File(["photo"], "gym.jpg", { type: "image/jpeg" }));
  await act(async () => button("Upload and add to profile").click());
  await until(() => host.textContent!.includes("Save unavailable"));
  await act(async () => button("Upload and add to profile").click());
  await until(() => host.textContent!.includes("Media added"));
  expect(mocks.upload).toHaveBeenCalledOnce();
});
it("rejects PDF files before requesting any upload", async () => {
  await render(<GymMediaEditor gym={{ media: [] }} />);
  await choose(new File(["pdf"], "file.pdf", { type: "application/pdf" }));
  await act(async () => button("Upload and add to profile").click());
  await until(() => host.textContent!.includes("Choose a JPG"));
  expect(mocks.request).not.toHaveBeenCalled();
});
it("removes the selected cover from the profile without deleting its storage object", async () => {
  await render(
    <GymMediaEditor
      gym={{
        mediaAttachmentIds: ["photo"],
        coverAttachmentId: "photo",
        media: [
          {
            _id: "photo",
            mimeType: "image/jpeg",
            name: "Gym",
            url: "https://storage.test/photo",
          },
        ],
      }}
    />,
  );
  await act(async () => button("Remove from profile").click());
  expect(mocks.request).toHaveBeenCalledWith("/api/v1/owner/gym", {
    method: "PATCH",
    body: JSON.stringify({ mediaAttachmentIds: [], coverAttachmentId: null }),
  });
});
it("saves a full week with closed days and overnight hours", async () => {
  await render(
    <GymHoursEditor
      gym={{
        openingHours: [
          { day: 1, closed: false, opensAt: "22:00", closesAt: "05:00" },
        ],
        timezone: "Asia/Kolkata",
      }}
    />,
  );
  await act(async () =>
    host
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  const body = JSON.parse(mocks.request.mock.calls[0][1].body);
  expect(body.openingHours).toHaveLength(7);
  expect(body.openingHours[0]).toEqual({ day: 0, closed: true });
  expect(body.openingHours[1]).toMatchObject({
    opensAt: "22:00",
    closesAt: "05:00",
    closed: false,
  });
});
it("requires confirming the new entrance and saves longitude before latitude", async () => {
  await render(
    <GymLocationEditor
      gym={{
        address: {
          line1: "Street",
          state: "Telangana",
          postalCode: "500001",
          country: "IN",
        },
        location: { coordinates: [78, 17] },
      }}
    />,
  );
  expect(button("Save gym location").disabled).toBe(true);
  await act(async () => button("Detect entrance").click());
  await act(async () =>
    host
      .querySelector<HTMLInputElement>(".registration-confirm input")!
      .click(),
  );
  await act(async () =>
    host
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  expect(JSON.parse(mocks.request.mock.calls[0][1].body)).toMatchObject({
    address: { city: "Hyderabad", line1: "Street" },
    location: { coordinates: [78.45, 17.45] },
  });
  expect(host.querySelector("form form")).toBeNull();
});

it("lets the owner publish a membership directly from the gym profile", async () => {
  const fields: any[] = [
    { key: "name", label: "Plan name", required: true },
    { key: "code", label: "Plan code", required: true },
    { key: "durationDays", label: "Days", type: "number", required: true },
    { key: "priceMinor", label: "Price", type: "money", required: true },
    {
      key: "status",
      label: "Status",
      type: "select",
      options: ["DRAFT", "ACTIVE", "INACTIVE"],
    },
  ];
  mocks.request.mockResolvedValue({ data: [] });
  await render(
    <MemoryRouter>
      <GymProfilePlans fields={fields} canWrite slug="selected-gym" />
    </MemoryRouter>,
  );
  await until(() => host.textContent!.includes("No published memberships yet"));
  await act(async () => button("Add membership plan").click());
  const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
  expect(dialog).not.toBeNull();
  expect(host.contains(dialog)).toBe(false);
  for (const [label, value] of [
    ["Plan name", "Monthly"],
    ["Plan code", "MONTHLY"],
    ["Days", "30"],
    ["Price", "1500"],
  ]) {
    const input = [...dialog.querySelectorAll("label")]
      .find((el) => el.textContent?.startsWith(label))!
      .querySelector("input")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }
  await act(async () =>
    dialog
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  await until(() =>
    mocks.request.mock.calls.some((c) => c[1]?.method === "POST"),
  );
  const saved = mocks.request.mock.calls.find((c) => c[1]?.method === "POST")!;
  expect(saved[0]).toBe("/api/v1/owner/plans");
  expect(JSON.parse(saved[1].body)).toMatchObject({
    name: "Monthly",
    code: "MONTHLY",
    durationDays: 30,
    priceMinor: 150000,
    status: "ACTIVE",
  });
});
it("shows draft visibility and hides editing from staff without plan permission", async () => {
  mocks.request.mockResolvedValue({
    data: [
      {
        publicId: "draft",
        name: "Monthly draft",
        durationDays: 30,
        priceMinor: 150000,
        status: "DRAFT",
      },
    ],
  });
  await render(
    <MemoryRouter>
      <GymProfilePlans fields={[]} canWrite={false} slug="selected-gym" />
    </MemoryRouter>,
  );
  await until(() => host.textContent!.includes("Monthly draft"));
  expect(host.textContent).toContain("Draft ? hidden");
  expect(button("Add membership plan")).toBeUndefined();
  expect(button("Edit Monthly draft")).toBeUndefined();
  expect(host.querySelector("a")!.getAttribute("href")).toBe(
    "/gyms/selected-gym#gym-plans",
  );
});
