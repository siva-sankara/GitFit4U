// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("../services/apiClient", () => ({ apiRequest: mocks.request }));
vi.mock("./LocationMap", () => ({
  LocationMap: ({ onChange }: any) => (
    <button
      type="button"
      onClick={() => onChange({ latitude: 17.4, longitude: 78.5 })}
    >
      Choose test map pin
    </button>
  ),
}));
import { LocationPicker } from "./LocationPicker";
import { EditForm } from "../pages/live/LiveData";
import { parseCoordinates, googleMapsPin } from "../services/location";
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
  mocks.request.mockImplementation((path: string) =>
    Promise.resolve(
      path === "/api/v1/locations/config"
        ? { data: { configured: true, provider: "LOCATIONIQ" } }
        : path === "/api/v1/locations/reverse-geocode"
          ? {
              data: {
                latitude: 17.401,
                longitude: 78.501,
                displayName: "Nearby street",
                address: {
                  line1: "12 Example Street",
                  city: "Hyderabad",
                  state: "Telangana",
                  postalCode: "500001",
                  country: "IN",
                },
              },
            }
          : { data: [] },
    ),
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
  host.remove();
  vi.unstubAllGlobals();
});
async function tick() {
  await act(async () => {
      await new Promise((resolve) => { setTimeout(resolve, 20); });
  });
}
async function until(predicate: () => boolean) {
  for (let n = 0; n < 50 && !predicate(); n++) await tick();
  expect(predicate()).toBe(true);
}
async function render(element: React.ReactNode) {
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>{element}</QueryClientProvider>,
    ),
  );
  await until(() => host.textContent!.includes("Choose test map pin"));
}
function button(text: string) {
  return Array.from(host.querySelectorAll("button")).find(
    (b) => b.textContent === text,
  )!;
}
it("keeps a selected map pin instead of replacing it with a reverse-geocoded centroid", async () => {
  const changed = vi.fn();
  await render(<LocationPicker onChange={changed} />);
  await act(async () => button("Choose test map pin").click());
  await until(() => changed.mock.calls.length >= 2);
  expect(changed.mock.lastCall?.[0]).toMatchObject({
    latitude: 17.4,
    longitude: 78.5,
    address: { city: "Hyderabad" },
  });
});
it("uses high-accuracy browser coordinates and reports measured accuracy", async () => {
  Object.defineProperty(navigator, "geolocation", {
    configurable: true,
    value: {
      getCurrentPosition: vi.fn((success: any) =>
        success({
          coords: { latitude: 17.385, longitude: 78.487, accuracy: 12 },
          timestamp: Date.now(),
        }),
      ),
    },
  });
  const changed = vi.fn();
  await render(<LocationPicker onChange={changed} />);
  await act(async () => button("Use my current location").click());
  await until(() => changed.mock.calls.length >= 2);
  expect(changed.mock.lastCall?.[0]).toMatchObject({
    latitude: 17.385,
    longitude: 78.487,
    accuracyMeters: 12,
  });
  expect(navigator.geolocation.getCurrentPosition).toHaveBeenCalledWith(
    expect.any(Function),
    expect.any(Function),
    expect.objectContaining({ enableHighAccuracy: true, maximumAge: 0 }),
  );
});
it("fills and submits numeric coordinates and address fields in the actual form", async () => {
  await render(
    <EditForm
      locationPicker
      endpoint="/save-gym"
      fields={[
        { key: "latitude", label: "Latitude", type: "number", required: true },
        {
          key: "longitude",
          label: "Longitude",
          type: "number",
          required: true,
        },
        { key: "address.city", label: "City" },
        { key: "address.state", label: "State" },
      ]}
    />,
  );
  expect(button("Save").disabled).toBe(true);
  await act(async () => button("Choose test map pin").click());
  await until(() =>
    Array.from(host.querySelectorAll<HTMLInputElement>("input")).some(
      (input) => input.value === "Hyderabad",
    ),
  );
  await act(async () =>
    host
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  const saved = mocks.request.mock.calls.find(
    (call) => call[0] === "/save-gym",
  )!;
  expect(JSON.parse(saved[1].body)).toEqual({
    latitude: 17.4,
    longitude: 78.5,
    address: { city: "Hyderabad", state: "Telangana" },
  });
});
it("retains coordinates when an address cannot be resolved", async () => {
  const original = mocks.request.getMockImplementation()!;
  mocks.request.mockImplementation((path, ...rest) =>
    path === "/api/v1/locations/reverse-geocode"
      ? Promise.reject(new Error("No street address found"))
      : original(path, ...rest),
  );
  const changed = vi.fn();
  await render(<LocationPicker onChange={changed} />);
  await act(async () => button("Choose test map pin").click());
  await until(() => host.textContent!.includes("Your chosen pin is retained"));
  expect(changed).toHaveBeenCalledTimes(1);
  expect(changed).toHaveBeenCalledWith({ latitude: 17.4, longitude: 78.5 });
});
it("validates pasted coordinates and creates a marked Google Maps link", () => {
  expect(parseCoordinates("17.385, 78.487")).toEqual({
    latitude: 17.385,
    longitude: 78.487,
  });
  expect(parseCoordinates("0, 0")).toEqual({ latitude: 0, longitude: 0 });
  expect(parseCoordinates("100, 181")).toBeNull();
  expect(parseCoordinates("https://untrusted.example")).toBeNull();
  expect(googleMapsPin({ latitude: 17.385, longitude: 78.487 })).toContain(
    "query=17.385%2C78.487",
  );
});
