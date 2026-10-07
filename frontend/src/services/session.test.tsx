// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { getAccessToken, setAccessToken } from "./apiClient";
import { useSession } from "./session";

afterEach(() => { setAccessToken(null); localStorage.clear(); sessionStorage.clear(); vi.unstubAllGlobals(); });

it("restores a visible visit from its cookie even after all JavaScript storage is cleared", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  localStorage.clear(); sessionStorage.clear();
  const fetcher = vi.fn(async (url: string) => new Response(JSON.stringify({ success: true,
    data: url.endsWith("/refresh") ? { accessToken: "cookie-restored-token" } : { user: { name: "Member" } },
  })));
  vi.stubGlobal("fetch", fetcher);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const host = document.createElement("div");
  const root = createRoot(host);
  function Account() {
    const session = useSession({ publicPage: true, recoverSession: true });
    return <div>{session.data?.data.user.name || "Checking session"}</div>;
  }
  try {
    await act(async () => {
      root.render(<QueryClientProvider client={client}><Account /></QueryClientProvider>);
    });
    await act(async () => { await new Promise(resolve => { setTimeout(resolve, 20); }); });
    expect(host.textContent).toBe("Member");
    expect(getAccessToken()).toBe("cookie-restored-token");
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual(["/api/v1/auth/refresh", "/api/v1/auth/me"]);
    expect(fetcher).toHaveBeenNthCalledWith(1, "/api/v1/auth/refresh", expect.objectContaining({ credentials: "include", body: '{"activity":true}' }));
    expect(sessionStorage.getItem("gfu_access_token")).toBeNull();
  } finally {
    await act(async () => root.unmount());
    client.clear();
  }
});
