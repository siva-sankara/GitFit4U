// @vitest-environment jsdom
import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  decode: vi.fn(),
  stop: vi.fn(),
  request: vi.fn(),
  location: vi.fn(),
  media: vi.fn(),
  trackStop: vi.fn(),
}));
vi.mock("@zxing/browser", () => ({
  BrowserQRCodeReader: class {
    decodeFromStream = mocks.decode;
  },
}));
vi.mock("../../services/apiClient", () => ({ apiRequest: mocks.request }));
vi.mock("../../services/location", () => ({ deviceLocation: mocks.location }));
import { AttendanceQrPage } from "./AttendanceQrPage";
let host: HTMLDivElement, root: Root, client: QueryClient;
beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: mocks.media },
  });
  mocks.media.mockReset().mockResolvedValue({ getTracks: () => [{ stop: mocks.trackStop }] });
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
async function render(strict = false) {
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          {strict ? <StrictMode><AttendanceQrPage /></StrictMode> : <AttendanceQrPage />}
        </MemoryRouter>
      </QueryClientProvider>,
    ),
  );
}
it("automatically opens a video-only rear-facing camera and releases it when leaving", async () => {
  await render();
  expect(mocks.media).toHaveBeenCalledWith({
      video: { facingMode: { ideal: "environment" } },
      audio: false,
  });
  expect(host.textContent).not.toContain("Open camera");
  await act(async () => root.render(null));
  expect(mocks.stop).toHaveBeenCalled();
  expect(mocks.trackStop).toHaveBeenCalled();
});
it("shows permission-denied errors without sending an attendance request", async () => {
  mocks.decode.mockRejectedValue(
    Object.assign(new Error("denied"), { name: "NotAllowedError" }),
  );
  await render();
  expect(host.textContent).toContain("Camera permission was denied");
  expect(mocks.request).not.toHaveBeenCalled();
});
it("submits a scanned gym QR only once and displays duplicate check-in feedback", async () => {
  mocks.request.mockResolvedValue({
    success: true,
    data: { duplicate: true, event: { occurredAt: new Date().toISOString() } },
  });
  await render();
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
  expect(host.textContent).toContain("Camera access requires HTTPS");
  expect(mocks.decode).not.toHaveBeenCalled();
});

it("does not double-open the camera in Strict Mode", async () => {
  await render(true); expect(mocks.media).toHaveBeenCalledTimes(1);
});

it("shows pending permission and releases a stream that arrives after unmount", async () => {
  let resolve!: (value: unknown) => void;
  mocks.media.mockReturnValue(new Promise(done => { resolve = done; }));
  await render(); expect(host.textContent).toContain("Waiting for camera access");
  await act(async () => root.render(null));
  await act(async () => resolve({ getTracks: () => [{ stop: mocks.trackStop }] }));
  expect(mocks.trackStop).toHaveBeenCalledOnce(); expect(mocks.decode).not.toHaveBeenCalled();
});

it("falls back to another available video camera when the preferred constraint fails", async () => {
  mocks.media.mockRejectedValueOnce(Object.assign(new Error("constraints"), { name:"OverconstrainedError" }));
  await render();
  expect(mocks.media).toHaveBeenNthCalledWith(2, { video:true, audio:false });
  expect(mocks.decode).toHaveBeenCalledOnce();
});

it("does not request a camera while initially hidden and stops it when backgrounded", async () => {
  Object.defineProperty(document, "visibilityState", { configurable:true, value:"hidden" });
  await render(); expect(mocks.media).not.toHaveBeenCalled();
  await act(async () => { Object.defineProperty(document, "visibilityState", { configurable:true, value:"visible" }); document.dispatchEvent(new Event("visibilitychange")); });
  expect(mocks.media).toHaveBeenCalledOnce();
  await act(async () => { Object.defineProperty(document, "visibilityState", { configurable:true, value:"hidden" }); document.dispatchEvent(new Event("visibilitychange")); });
  expect(mocks.trackStop).toHaveBeenCalled();
  const callback = mocks.decode.mock.calls[0][2];
  await act(async () => callback({ getText: () => "late-qr" }, null, { stop:mocks.stop }));
  expect(mocks.request).not.toHaveBeenCalled();
});

it("does not submit after logout while location permission is pending", async () => {
  let resolve!: (value: unknown) => void;
  mocks.location.mockReturnValue(new Promise(done => { resolve = done; }));
  await render();
  await act(async () => mocks.decode.mock.calls[0][2]({ getText: () => "qr" }, null, { stop:mocks.stop }));
  await act(async () => window.dispatchEvent(new CustomEvent("gfu-auth", { detail:{ token:null } })));
  await act(async () => resolve({ longitude:77, latitude:12, accuracyMeters:10, capturedAt:new Date().toISOString() }));
  expect(mocks.request).not.toHaveBeenCalled(); expect(host.textContent).toContain("Camera paused");
});

it.each([["NotFoundError","No camera was found"], ["NotReadableError","camera is busy"]])("explains %s and offers an explicit camera retry", async (name,message) => {
  mocks.media.mockRejectedValueOnce(Object.assign(new Error("camera"), { name }));
  await render(); expect(host.textContent).toContain(message);
  const retry = [...host.querySelectorAll("button")].find(button => button.textContent?.includes("Retry camera"));
  expect(retry).toBeDefined();
  await act(async () => retry!.click());
  expect(mocks.decode).toHaveBeenCalledOnce();
});

it("shows rejected QR errors and allows another scan without a duplicate submission", async () => {
  mocks.request.mockRejectedValueOnce(new Error("This is not a valid gym attendance QR."));
  await render();
  await act(async () => { mocks.decode.mock.calls[0][2]({ getText: () => "unrelated QR" }, null, { stop:mocks.stop }); await new Promise(resolve => { setTimeout(resolve,20); }); });
  expect(host.textContent).toContain("not a valid gym attendance QR");
  const retry = [...host.querySelectorAll("button")].find(button => button.textContent?.includes("Scan again"));
  await act(async () => retry!.click());
  expect(mocks.decode).toHaveBeenCalledTimes(2); expect(mocks.request).toHaveBeenCalledOnce();
});
