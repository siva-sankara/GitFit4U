// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ logout: vi.fn() }));
vi.mock("../services/apiClient", () => ({
  logoutSession: mocks.logout,
  ApiError: class extends Error {
    constructor(
      public status: number,
      public code: string,
      message: string,
    ) {
      super(message);
    }
  },
}));
import { ApiError } from "../services/apiClient";
import { SessionFailure } from "./SessionFailure";
let host: HTMLDivElement, root: Root, client: QueryClient;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  client = new QueryClient();
});
afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
  host.remove();
});
async function render() {
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={["/owner/members"]}>
          <Routes>
            <Route
              path="/owner/members"
              element={
                <SessionFailure
                  error={
                    new ApiError(
                      403,
                      "ROLE_REVOKED",
                      "Your gym access is no longer available.",
                    )
                  }
                  retry={vi.fn()}
                />
              }
            />
            <Route path="/login" element={<p>Login screen</p>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    ),
  );
}
it("can end a revoked-role session and open login without a retry loop", async () => {
  mocks.logout.mockResolvedValue(undefined);
  await render();
  await act(async () => host.querySelector("button")!.click());
  expect(mocks.logout).toHaveBeenCalledOnce();
  expect(host.textContent).toContain("Login screen");
});
it("stays locally signed out if server revocation must be retried later", async () => {
  mocks.logout.mockRejectedValue(new Error("Unable to connect"));
  await render();
  await act(async () => host.querySelector("button")!.click());
  expect(mocks.logout).toHaveBeenCalledOnce();
  expect(host.textContent).toContain("Login screen");
});
