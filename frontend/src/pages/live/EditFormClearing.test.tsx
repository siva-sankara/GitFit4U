// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ request: vi.fn(async () => ({ data: {} })) }));
vi.mock("../../services/apiClient", () => ({ apiRequest: mocks.request }));
import { EditForm } from "./LiveData";
it("sends explicit null for opt-in clearable fields while preserving omitted optional values", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host), client = new QueryClient();
  try {
    await act(async () => root.render(<QueryClientProvider client={client}><EditForm endpoint="/api/v1/owner/gym" method="PATCH" fields={[{ key: "contact.website", label: "Website", clearable: true }, { key: "description", label: "Description" }]} /></QueryClientProvider>));
    await act(async () => host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(JSON.parse((mocks.request.mock.calls[0] as any)[1].body)).toEqual({ contact: { website: null } });
  } finally { await act(async () => root.unmount()); client.clear(); host.remove(); }
});
