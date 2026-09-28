// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { expect, it, vi } from "vitest";
vi.mock("../components/PublicHeader", () => ({ PublicHeader: () => <header>Public navigation</header> }));
vi.mock("../components/AppInstallBanner", () => ({ AppHeader: ({ children }: { children: React.ReactNode }) => children }));
import { PublicLayout } from "./PublicLayout";
it("only advertises the implemented public footer destinations, without registration or unapproved legal previews", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement("div"), root = createRoot(host);
  try {
    await act(async () => root.render(<MemoryRouter><PublicLayout /></MemoryRouter>));
    expect([...host.querySelectorAll("footer a")].map(link => link.getAttribute("href"))).toEqual(["/", "/explore", "/help", "/contact"]);
    expect(host.querySelector('footer a[href="/register-gym"]')).toBeNull();
  } finally { await act(async () => root.unmount()); }
});
