// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Pagination, SectionAccordion, TooltipButton } from "./DataListControls";

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

it("shows a bounded page range, record range and disables unavailable navigation", async () => {
  const onPageChange = vi.fn();
  await act(async () => root.render(
    <Pagination page={1} limit={10} total={86} onPageChange={onPageChange} />,
  ));
  expect(host.textContent).toContain("Showing 1–10 of 86");
  expect(host.querySelector<HTMLButtonElement>('[aria-label="Previous page"]')?.disabled).toBe(true);
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Next page"]')!.click());
  expect(onPageChange).toHaveBeenCalledWith(2);
  expect(host.querySelectorAll(".pagination-pages button")).toHaveLength(5);
});

it("hides all pagination controls for an empty result and restores them when records arrive", async () => {
  const onPageChange = vi.fn(), onLimitChange = vi.fn();
  const render = (total: number, loading = false) => root.render(<Pagination page={1} limit={10} total={total} loading={loading} onPageChange={onPageChange} onLimitChange={onLimitChange} />);
  await act(async () => render(0, true));
  expect(host.querySelector("nav")).toBeNull();
  await act(async () => render(0));
  expect(host.querySelector("select")).toBeNull();
  expect(host.textContent).toBe("");
  await act(async () => render(21));
  expect(host.querySelector('[aria-label="Pagination"]')).not.toBeNull();
  expect(host.querySelector('[aria-label="Rows per page"]')).not.toBeNull();
  await act(async () => render(0));
  expect(host.textContent).toBe("");
});

it("allows returning from an empty last page when records still exist on earlier pages", async () => {
  const onPageChange = vi.fn();
  await act(async () => root.render(<Pagination page={3} limit={10} total={12} onPageChange={onPageChange} />));
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Previous page"]')!.click());
  expect(onPageChange).toHaveBeenCalledWith(1);
});

it("exposes tooltip help to keyboard users", async () => {
  await act(async () => root.render(
    <TooltipButton tooltip="Open payment and invoice details">View</TooltipButton>,
  ));
  const button = host.querySelector("button")!;
  button.focus();
  expect(document.activeElement).toBe(button);
  expect(button.title).toBe("Open payment and invoice details");
  expect(button.getAttribute("aria-label")).toBe("Open payment and invoice details");
  expect(button.dataset.tooltip).toBe("Open payment and invoice details");
});

it("keeps collapsed accordion content out of interaction until its accessible toggle opens it", async () => {
  await act(async () => root.render(
    <SectionAccordion title="Advanced settings"><button>Dangerous action</button></SectionAccordion>,
  ));
  const toggle = host.querySelector<HTMLButtonElement>(".section-accordion-toggle")!;
  const region = host.querySelector<HTMLElement>(".section-accordion-content")!;
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
  expect(region.hidden).toBe(true);
  await act(async () => toggle.click());
  expect(toggle.getAttribute("aria-expanded")).toBe("true");
  expect(region.hidden).toBe(false);
});
