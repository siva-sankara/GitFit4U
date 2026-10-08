// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { RouteErrorPage } from "./RouteErrorPage";

let host: HTMLDivElement;
let root: Root;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  vi.restoreAllMocks();
});

function BrokenScanner(): never {
  throw new TypeError(
    "Failed to fetch dynamically imported module: http://localhost:5173/src/pages/owner/OwnerScannerPage.tsx",
  );
}

it("replaces raw router errors with a safe recovery screen", async () => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  const router = createMemoryRouter(
    [
      {
        path: "/owner/scanner",
        element: <BrokenScanner />,
        errorElement: <RouteErrorPage />,
      },
    ],
    { initialEntries: ["/owner/scanner"] },
  );

  await act(async () => root.render(<RouterProvider router={router} />));

  expect(host.textContent).toContain("We couldn't load this screen");
  expect(host.textContent).toContain("Reload screen");
  expect(host.textContent).not.toContain("OwnerScannerPage.tsx");
  expect(host.querySelector('a[href="/owner/dashboard"]')).not.toBeNull();
});
