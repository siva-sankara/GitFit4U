// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { expect, it } from "vitest";
import { ProfileSectionRedirect } from "./ProfileSectionRedirect";
function Destination() { const location = useLocation(); return <output>{location.pathname + location.search + location.hash}</output>; }
it("retains invoice parameters while opening the Profile payments section", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement("div"), root = createRoot(host);
  try {
    await act(async () => root.render(<MemoryRouter initialEntries={["/app/profile/payments?invoice=invoice_123#details"]}><Routes>
      <Route path="/app/profile/payments" element={<ProfileSectionRedirect section="payments" />} />
      <Route path="/app/profile" element={<Destination />} />
    </Routes></MemoryRouter>));
    expect(host.textContent).toBe("/app/profile?invoice=invoice_123&section=payments#details");
  } finally { await act(async () => root.unmount()); }
});
it("preserves the exact legacy membership and navigation state", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement("div"), root = createRoot(host);
  function Result() { const location = useLocation(); return <output>{location.search}|{location.hash}|{location.state?.joinedGymName}</output>; }
  try {
    await act(async () => root.render(<MemoryRouter initialEntries={[{ pathname: "/app/subscriptions/membership_123", search: "?source=notification", hash: "#updates", state: { joinedGymName: "Gym A" } }]}><Routes>
      <Route path="/app/subscriptions/:id" element={<ProfileSectionRedirect section="membership" record={{ key: "membership", id: "membership_123" }} />} />
      <Route path="/app/profile" element={<Result />} />
    </Routes></MemoryRouter>));
    expect(host.textContent).toBe("?source=notification&section=membership&membership=membership_123|#updates|Gym A");
  } finally { await act(async () => root.unmount()); }
});
