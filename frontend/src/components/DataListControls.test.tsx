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
