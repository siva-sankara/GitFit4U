// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { expect, it } from "vitest";
import {
  PolicyDocumentPage,
  publishedPlatformPolicies,
  TermsAndPoliciesPage,
} from "./PoliciesPage";

async function renderPage(element: React.ReactNode, path: string) {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement("div");
  const root = createRoot(host);
  await act(async () =>
    root.render(<MemoryRouter initialEntries={[path]}>{element}</MemoryRouter>),
  );
  return { host, root };
}

it("publishes every platform policy from the public policy hub", async () => {
  const { host, root } = await renderPage(
    <TermsAndPoliciesPage />,
    "/terms-and-policies",
  );
  try {
    expect(host.querySelector("h1")?.textContent).toBe("GETFIT4U Terms & Policies");
    expect(host.querySelector('nav[aria-label="Breadcrumb"] a')?.getAttribute("href")).toBe("/");
    expect(host.querySelector('[aria-current="page"]')?.textContent).toBe("Terms & Policies");
    expect(host.textContent).toContain("Gym Profile Settings");
    expect(publishedPlatformPolicies).toHaveLength(4);
    for (const path of [
      "/terms-and-conditions",
      "/privacy-policy",
      "/refund-cancellation-policy",
      "/data-deletion",
    ]) {
      expect(host.querySelector(`a[href="${path}"]`)).not.toBeNull();
    }
    expect(host.textContent).not.toContain("awaiting publication");
  } finally {
    await act(async () => root.unmount());
  }
});

it.each([
  ["/terms-and-conditions", "GETFIT4U Terms & Conditions", "Health and safety"],
  ["/privacy-policy", "GETFIT4U Privacy Policy", "Meta and WhatsApp Business Platform data"],
  ["/refund-cancellation-policy", "GETFIT4U Refund & Cancellation Policy", "Offline payments"],
  ["/data-deletion", "GETFIT4U Data Deletion Instructions", "Meta and WhatsApp data deletion"],
] as const)("renders the complete public document at %s", async (path, title, requiredSection) => {
  const { host, root } = await renderPage(<PolicyDocumentPage path={path} />, path);
  try {
    expect(host.querySelector("h1")?.textContent).toBe(title);
    expect(host.textContent).toContain("Effective");
    expect(host.textContent).toContain("29 September 2026");
    expect(host.textContent).toContain(requiredSection);
    expect(host.querySelector('nav[aria-label="Breadcrumb"] a[href="/terms-and-policies"]')).not.toBeNull();
    expect(host.querySelector('a[href="/contact"]')).not.toBeNull();
    expect(host.querySelector("article")?.querySelectorAll(":scope > section").length).toBeGreaterThan(5);
  } finally {
    await act(async () => root.unmount());
  }
});

it("provides a specific public deletion path for GETFIT4U and Meta/WhatsApp data", async () => {
  const { host, root } = await renderPage(
    <PolicyDocumentPage path="/data-deletion" />,
    "/data-deletion",
  );
  try {
    expect(host.textContent).toContain("Data deletion request");
    expect(host.textContent).toContain("Meta/WhatsApp data deletion");
    expect(host.textContent).toContain("Identity verification");
    expect(host.textContent).toContain("Information that may be retained");
    expect(host.textContent).toContain("Never include your password");
  } finally {
    await act(async () => root.unmount());
  }
});
