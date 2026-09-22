// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ request: vi.fn(), token: vi.fn() }));
vi.mock("../services/apiClient", () => ({
  apiRequest: mocks.request,
  setAccessToken: mocks.token,
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
  mocks.request.mockResolvedValue(undefined);
  await render();
  await act(async () => host.querySelector("button")!.click());
  expect(mocks.request).toHaveBeenCalledWith("/api/v1/auth/logout", {
    method: "POST",
  });
  expect(mocks.token).toHaveBeenCalledWith(null);
  expect(host.textContent).toContain("Login screen");
});
it("keeps session recovery available if server logout fails", async () => {
  mocks.request.mockRejectedValue(new Error("Unable to connect"));
  await render();
  await act(async () => host.querySelector("button")!.click());
  expect(mocks.token).not.toHaveBeenCalled();
  expect(host.textContent).toContain("Unable to connect");
  expect(host.querySelector("button")?.disabled).toBe(false);
});
