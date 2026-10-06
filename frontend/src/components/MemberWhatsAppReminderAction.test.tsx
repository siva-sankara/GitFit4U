// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  notify: vi.fn(),
  open: vi.fn(),
}));
vi.mock("../services/apiClient", () => ({ apiRequest: mocks.request }));
vi.mock("../context/AppContext", () => ({
  useOptionalApp: () => ({ notify: mocks.notify }),
}));
import { MemberWhatsAppReminderAction } from "./MemberWhatsAppReminderAction";

let host: HTMLDivElement;
let root: Root;
const member = {
  publicId: "member-public",
  contact: { name: "Mark" },
  invitation: { status: "PENDING" },
};

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  mocks.open.mockReturnValue({});
  vi.stubGlobal("open", mocks.open);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

it("opens the backend-prepared fallback and reports the manual hand-off", async () => {
  mocks.request.mockResolvedValue({
    data: {
      mode: "fallback",
      waUrl: "https://wa.me/919999799900?text=Hi%20Mark",
    },
  });
  await act(async () => root.render(<MemberWhatsAppReminderAction member={member} canManage />));
  await act(async () => {
    host.querySelector<HTMLButtonElement>(
      'button[aria-label="Send WhatsApp reminder to Mark"]',
    )!.click();
  });
  expect(mocks.request).toHaveBeenCalledWith(
    "/api/v1/owner/members/member-public/communication/whatsapp-reminder",
    expect.objectContaining({
      method: "POST",
      idempotencyKey: expect.any(String),
      body: JSON.stringify({
        reason: "activation_invitation",
        source: "members_list",
      }),
    }),
  );
  expect(mocks.open).toHaveBeenCalledWith(
    "https://wa.me/919999799900?text=Hi%20Mark",
    "_blank",
    "noopener,noreferrer",
  );
  expect(mocks.notify).toHaveBeenCalledWith(
    "WhatsApp opened with reminder text.",
  );
});

it("queues official delivery without opening a browser and suppresses fast duplicates", async () => {
  let resolve!: (value: unknown) => void;
  mocks.request.mockReturnValue(new Promise((done) => { resolve = done; }));
  await act(async () => root.render(<MemberWhatsAppReminderAction member={member} canManage />));
  const button = host.querySelector<HTMLButtonElement>("button")!;
  await act(async () => {
    button.click();
    button.click();
  });
  expect(mocks.request).toHaveBeenCalledTimes(1);
  await act(async () => resolve({ data: { mode: "integrated" } }));
  expect(mocks.open).not.toHaveBeenCalled();
  expect(mocks.notify).toHaveBeenCalledWith("WhatsApp reminder queued.");
});

it("shows backend failures as a toast and retains the retry key", async () => {
  mocks.request.mockRejectedValue(new Error("Approved WhatsApp template unavailable."));
  await act(async () => root.render(<MemberWhatsAppReminderAction member={member} canManage />));
  await act(async () => host.querySelector<HTMLButtonElement>("button")!.click());
  expect(mocks.notify).toHaveBeenCalledWith(
    "Approved WhatsApp template unavailable.",
  );
  expect(mocks.open).not.toHaveBeenCalled();
});
