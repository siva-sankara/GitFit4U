// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ request:vi.fn(), qr:vi.fn(), gym:"gym-a" }));
vi.mock("../../services/apiClient", () => ({ apiRequest:mocks.request }));
vi.mock("../../api/hooks", () => ({ useCurrentUser:() => ({ data:{ data:{ context:{ gymId:mocks.gym, permissions:["gym:update","attendance:scan"] } } } }) }));
vi.mock("qrcode.react", () => ({ QRCodeSVG:(props:Record<string,unknown>) => { mocks.qr(props); return <svg data-token={String(props.value)} />; } }));
import { OwnerScannerPage } from "./OwnerScannerPage";
let root:Root, host:HTMLDivElement, client:QueryClient;
beforeEach(() => {
  vi.clearAllMocks(); mocks.gym = "gym-a";
  Object.assign(globalThis,{ IS_REACT_ACT_ENVIRONMENT:true });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  client = new QueryClient({ defaultOptions:{ queries:{ retry:false } } });
  mocks.request.mockResolvedValue({ data:{ token:"getfit4u:gym:persisted-public-reference", gymName:"Example gym", locationRequired:false } });
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); host.remove(); vi.restoreAllMocks(); });
async function render() {
  await act(async () => root.render(<MemoryRouter><QueryClientProvider client={client}><OwnerScannerPage /></QueryClientProvider></MemoryRouter>));
  for (let i=0;i<50 && !host.querySelector("svg[data-token]");i++) await act(async () => { await new Promise(resolve => { setTimeout(resolve,10); }); });
}
it("renders the exact persisted token with a durable white quiet zone and no replace action", async () => {
  await render();
  expect(mocks.qr).toHaveBeenLastCalledWith(expect.objectContaining({ value:"getfit4u:gym:persisted-public-reference", marginSize:4, bgColor:"#ffffff", fgColor:"#000000" }));
  expect(host.textContent).toContain("Permanent gym QR");
  expect(host.textContent).not.toContain("Replace QR");
  expect(host.textContent).toContain("Manual attendance exception");
  await act(async () => client.invalidateQueries({ queryKey:["api"] }));
  expect(mocks.qr).toHaveBeenLastCalledWith(expect.objectContaining({ value:"getfit4u:gym:persisted-public-reference" }));
  expect(mocks.request.mock.calls.every(([path]) => path === "/api/v1/owner/attendance/qr")).toBe(true);
});
it("keeps the gym QR cache partitioned when changing workspaces", async () => {
  await render();
  mocks.gym = "gym-b"; mocks.request.mockReturnValue(new Promise(() => {}));
  await act(async () => root.render(<MemoryRouter><QueryClientProvider client={client}><OwnerScannerPage /></QueryClientProvider></MemoryRouter>));
  expect(host.querySelector("svg[data-token]")).toBeNull();
});
