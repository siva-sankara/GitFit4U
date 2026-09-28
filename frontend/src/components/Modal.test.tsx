// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { Modal } from "./Modal";
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  document.body.style.overflow = "";
});
it("portals above workspace, traps keyboard focus and restores the opener", async () => {
  const opener = document.createElement("button");
  document.body.append(opener);
  opener.focus();
  const close = vi.fn();
  await act(async () =>
    root.render(
      <Modal open title="Create member" onClose={close}>
        <input aria-label="Name" />
        <button>Save</button>
      </Modal>,
    ),
  );
  const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
  expect(host.contains(dialog)).toBe(false);
  expect(dialog.querySelector(".modal-header")?.textContent).toContain(
    "Create member",
  );
  expect(document.body.style.overflow).toBe("hidden");
  const buttons = dialog.querySelectorAll<HTMLButtonElement>("button");
  buttons[buttons.length - 1].focus();
  document.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Tab", cancelable: true }),
  );
  expect(document.activeElement).toBe(buttons[0]);
  document.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", cancelable: true }),
  );
  expect(close).toHaveBeenCalledOnce();
  await act(async () =>
    root.render(
      <Modal open={false} title="Create member" onClose={close}>
        Empty
      </Modal>,
    ),
  );
  expect(document.body.style.overflow).toBe("");
  expect(document.activeElement).toBe(opener);
  opener.remove();
});
it("keeps scroll locked while a parent dialog remains open and uses unique labels", async () => {
  const view = (child: boolean) => (
    <>
      <Modal open title="Parent" onClose={() => undefined}>
        <button>Parent action</button>
      </Modal>
      <Modal open={child} title="Child" onClose={() => undefined}>
        Child content
      </Modal>
    </>
  );
  await act(async () => root.render(view(true)));
  const labels = [...document.querySelectorAll('[role="dialog"]')].map((v) =>
    v.getAttribute("aria-labelledby"),
  );
  expect(new Set(labels).size).toBe(2);
  await act(async () => root.render(view(false)));
  expect(document.body.style.overflow).toBe("hidden");
});
