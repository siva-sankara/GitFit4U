// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PhoneInput } from "./PhoneInput";
import { normalizeContactPhone } from "../services/contactPhoneInput";

let host: HTMLDivElement, root: Root;
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
async function render(initial = "", required = false) {
  function Form() {
    const [value, setValue] = useState(initial);
    return <form><label>Contact phone<PhoneInput name="phone" value={value} onValueChange={setValue} required={required} /></label><output>{value}</output></form>;
  }
  await act(async () => root.render(<Form />));
}
function field() { return host.querySelector<HTMLInputElement>('input[name="phone"]')!; }
async function fill(value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field(), value);
    field().dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function paste(value: string, start = 0, end = field().value.length) {
  field().setSelectionRange(start, end);
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", { value: { getData: () => value } });
  await act(async () => field().dispatchEvent(event));
}
it("uses a ten-digit India input, separate prefix and canonical submitted state", async () => {
  await render("+919876543210");
  expect(field().value).toBe("9876543210");
  expect(field().type).toBe("tel"); expect(field().inputMode).toBe("numeric");
  expect(field().maxLength).toBe(10); expect(field().minLength).toBe(10);
  expect(field().autocomplete).toBe("tel-national");
  await fill("9123456789");
  expect(host.querySelector("output")?.textContent).toBe("+919123456789");
  expect(field().checkValidity()).toBe(true);
});
it("rejects oversized and arbitrary input without altering the previous number", async () => {
  await render("9876543210");
  for (const value of ["98765432101", "123e456789", "98765.43210", "call 9876543210"]) {
    await fill(value);
    expect(field().value).toBe("9876543210"); expect(field().checkValidity()).toBe(false);
  }
  await fill("9123456789"); expect(field().checkValidity()).toBe(true);
});
it("keeps rejected paste invalid even when the previous value was complete", async () => {
  await render("9876543210"); await paste("987654321012");
  expect(field().value).toBe("9876543210"); expect(field().checkValidity()).toBe(false);
  expect(host.textContent).toContain("Enter a 10-digit");
  await paste("+91 (91234) 56789");
  expect(field().value).toBe("9123456789"); expect(field().checkValidity()).toBe(true);
});
it("supports selection replacement, deletion, incomplete feedback and autofill", async () => {
  await render("9876543210", true);
  await paste("12", 2, 4); expect(field().value).toBe("9812543210");
  await fill("981254321"); expect(field().checkValidity()).toBe(false);
  await fill(""); expect(field().checkValidity()).toBe(false);
  await fill("+919876543210"); expect(field().value).toBe("9876543210"); expect(field().checkValidity()).toBe(true);
});
it("allows optional blanks and preserves explicit existing international numbers", async () => {
  await render("+442079460123");
  expect(field().value).toBe("+442079460123"); expect(field().maxLength).toBe(16);
  expect(field().checkValidity()).toBe(true);
  await fill("2025550147"); expect(field().value).toBe("+442079460123"); expect(field().checkValidity()).toBe(false);
  await paste("+1 (202) 555-0147"); expect(field().value).toBe("+12025550147");
  await fill(""); expect(field().checkValidity()).toBe(true);
});
it("never lets a malformed contact normalize into a different valid phone", () => {
  expect(normalizeContactPhone("+91 98765-43210")).toBe("+919876543210");
  expect(normalizeContactPhone("+44 20 7946 0123")).toBe("+442079460123");
  for (const input of ["12345678901", "call 9876543210", "123.4567890", "+9198765432109", "09876543210"])
    expect(normalizeContactPhone(input)).toBeUndefined();
  expect(normalizeContactPhone("")).toBe("");
});
it("forwards focus refs and reports invalid edits to non-native form validators", async () => {
  const invalid = vi.fn(), ref = { current: null as HTMLInputElement | null };
  await act(async () => root.render(<PhoneInput ref={ref} name="phone" defaultValue="9876543210" onValidityChange={invalid} />));
  await paste("oversized1234567890123"); expect(invalid).toHaveBeenLastCalledWith(true);
  ref.current?.focus(); expect(document.activeElement).toBe(field());
  await paste("9876543210"); expect(invalid).toHaveBeenLastCalledWith(false);
});
