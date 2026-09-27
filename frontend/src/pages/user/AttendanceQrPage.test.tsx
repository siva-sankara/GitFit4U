// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  decode: vi.fn(),
  stop: vi.fn(),
  request: vi.fn(),
  location: vi.fn(),
}));
vi.mock("@zxing/browser", () => ({
  BrowserQRCodeReader: class {
    decodeFromConstraints = mocks.decode;
  },
}));
vi.mock("../../services/apiClient", () => ({ apiRequest: mocks.request }));
vi.mock("../../services/location", () => ({ deviceLocation: mocks.location }));
import { AttendanceQrPage } from "./AttendanceQrPage";
let host: HTMLDivElement, root: Root, client: QueryClient;
beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: vi.fn() },
  });
  mocks.decode.mockResolvedValue({ stop: mocks.stop });
  mocks.location.mockResolvedValue({
    longitude: 77,
    latitude: 12,
    accuracyMeters: 10,
    capturedAt: new Date().toISOString(),
  });
  mocks.request.mockResolvedValue({
    success: true,
    data: { duplicate: false, event: { occurredAt: new Date().toISOString() } },
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  client.clear();
});
async function render() {
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <AttendanceQrPage />
        </MemoryRouter>
      </QueryClientProvider>,
    ),
  );
}
async function start() {
  await act(async () =>
    [...host.querySelectorAll("button")]
      .find((b) => b.textContent?.includes("Open camera"))!
      .click(),
  );
}
it("opens a rear-facing camera and releases it when leaving", async () => {
  await render();
  await start();
  expect(mocks.decode).toHaveBeenCalledWith(
    expect.objectContaining({
      video: { facingMode: { ideal: "environment" } },
      audio: false,
    }),
    expect.any(HTMLVideoElement),
    expect.any(Function),
  );
  await act(async () => root.render(null));
  expect(mocks.stop).toHaveBeenCalled();
});
it("shows permission-denied errors without sending an attendance request", async () => {
  mocks.decode.mockRejectedValue(
    Object.assign(new Error("denied"), { name: "NotAllowedError" }),
  );
  await render();
  await start();
  expect(host.textContent).toContain("Camera permission was denied");
  expect(mocks.request).not.toHaveBeenCalled();
});
it("submits a scanned gym QR only once and displays duplicate check-in feedback", async () => {
  mocks.request.mockResolvedValue({
    success: true,
    data: { duplicate: true, event: { occurredAt: new Date().toISOString() } },
  });
  await render();
  await start();
  const callback = mocks.decode.mock.calls[0][2];
  await act(async () => {
    callback({ getText: () => "signed-gym-token" }, null, { stop: mocks.stop });
    callback({ getText: () => "signed-gym-token" }, null, { stop: mocks.stop });
      await new Promise((resolve) => { setTimeout(resolve, 20); });
  });
  expect(mocks.request).toHaveBeenCalledTimes(1);
  expect(mocks.request).toHaveBeenCalledWith(
    "/api/v1/users/me/attendance/check-in",
    expect.objectContaining({
      method: "POST",
      body: expect.stringContaining("signed-gym-token"),
    }),
  );
  expect(host.textContent).toContain("Already checked in today");
});
it("explains unavailable camera support", async () => {
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: undefined,
  });
  await render();
  await start();
  expect(host.textContent).toContain("Camera access requires HTTPS");
  expect(mocks.decode).not.toHaveBeenCalled();
});
