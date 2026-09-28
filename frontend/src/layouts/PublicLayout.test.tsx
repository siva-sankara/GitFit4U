// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { expect, it, vi } from "vitest";
vi.mock("../components/PublicHeader", () => ({ PublicHeader: () => <header>Public navigation</header> }));
vi.mock("../components/AppInstallBanner", () => ({ AppHeader: ({ children }: { children: React.ReactNode }) => children }));
import { PublicLayout } from "./PublicLayout";
it("links every published legal document from the public footer", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement("div"), root = createRoot(host);
  try {
    await act(async () => root.render(<MemoryRouter><PublicLayout /></MemoryRouter>));
    expect([...host.querySelectorAll("footer a")].map(link => link.getAttribute("href"))).toEqual(["/", "/explore", "/help", "/contact", "/terms-and-policies", "/terms-and-conditions", "/privacy-policy", "/refund-cancellation-policy", "/data-deletion"]);
    expect(host.querySelector('footer a[href="/terms-and-policies"]')?.textContent).toBe("Terms & Policies");
    expect(host.querySelector('footer a[href="/terms-and-conditions"]')?.textContent).toBe("Terms & Conditions");
    expect(host.querySelector('footer a[href="/privacy-policy"]')?.textContent).toBe("Privacy Policy");
    expect(host.querySelector('footer a[href="/data-deletion"]')?.textContent).toBe("Data Deletion");
    expect(host.querySelector('footer a[href="/register-gym"]')).toBeNull();
  } finally { await act(async () => root.unmount()); }
});
