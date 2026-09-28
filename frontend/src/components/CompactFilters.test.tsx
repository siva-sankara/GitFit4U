// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CompactFilters } from "./CompactFilters";
let host: HTMLDivElement, root: Root;
let narrow = true;
const reset = vi.fn(), apply = vi.fn();
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: narrow, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  reset.mockReset(); apply.mockReset();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); narrow = true; vi.unstubAllGlobals(); });
async function render() {
  await act(async () => root.render(<CompactFilters activeCount={2} onReset={reset} onApply={apply}><label>Maximum price<input name="price" /></label></CompactFilters>));
}
it("collapses mobile fields and exposes a named active count and working Apply/Reset", async () => {
  await render();
  const toggle = host.querySelector<HTMLButtonElement>(".compact-filter-toggle")!;
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
  expect(host.querySelector('[aria-label="2 active filters"]')).not.toBeNull();
  expect(host.querySelector<HTMLDivElement>(".compact-filter-content")!.hidden).toBe(true);
  await act(async () => toggle.click());
  expect(toggle.getAttribute("aria-expanded")).toBe("true");
  const buttons = [...host.querySelectorAll<HTMLButtonElement>(".compact-filter-actions button")];
  await act(async () => buttons[0].click()); expect(reset).toHaveBeenCalledOnce();
  apply.mockReturnValueOnce(false);
  await act(async () => buttons[1].click()); expect(toggle.getAttribute("aria-expanded")).toBe("true");
  await act(async () => buttons[1].click()); expect(toggle.getAttribute("aria-expanded")).toBe("false");
});
it("keeps desktop filter controls visible without a mobile toggle", async () => {
  narrow = false; await render();
  expect(host.querySelector(".compact-filter-toggle")).toBeNull();
  expect(host.querySelector<HTMLDivElement>(".compact-filter-content")!.hidden).toBe(false);
});
