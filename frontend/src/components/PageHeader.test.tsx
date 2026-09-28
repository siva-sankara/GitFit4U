// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { expect, it } from "vitest";
import { PageHeader } from "./PageHeader";
import { PageNavigationContext } from "./pageNavigation";
it("places one accessible icon-only Back control beside the real page heading", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement("div"), root = createRoot(host);
  try {
    await act(async () => root.render(<MemoryRouter initialEntries={["/owner/members/member-one"]}><PageNavigationContext.Provider value={{ role: "GYM_OWNER", permissions: ["member:read"] }}><PageHeader><div><h1>Member details</h1></div><div className="heading-actions"><button>Edit member</button></div></PageHeader></PageNavigationContext.Provider></MemoryRouter>));
    expect(host.querySelectorAll("h1")).toHaveLength(1);
    const header = host.querySelector("header")!;
    const back = header.querySelector(".workspace-breadcrumb-header > button");
    expect(back?.textContent).toBe("");
    expect(back?.getAttribute("aria-label")).toBe("Back to Members");
    expect(back?.querySelector("svg")).not.toBeNull();
    expect(header.querySelector('nav[aria-label="Breadcrumb"]')).toBeNull();
    expect(header.querySelector("h1")?.textContent).toBe("Member details");
  } finally { await act(async () => root.unmount()); }
});
it("does not manufacture page Back navigation on owner onboarding", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement("div"), root = createRoot(host);
  try {
    await act(async () => root.render(<MemoryRouter initialEntries={["/owner/onboarding"]}><PageNavigationContext.Provider value={{ role: "GYM_OWNER", permissions: [] }}><PageHeader><h1>Register your gym</h1></PageHeader></PageNavigationContext.Provider></MemoryRouter>));
    expect(host.querySelector('nav[aria-label="Breadcrumb"]')).toBeNull();
    expect(host.querySelector("button")).toBeNull();
  } finally { await act(async () => root.unmount()); }
});
