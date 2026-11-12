// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import { ListViewport } from "./ListViewport";

it("retains reading position for row updates and resets it when the list query changes", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement("div"), root = createRoot(host);
  document.body.append(host);
  try {
    const render = async (key: string, text: string) => {
      await act(async () => root.render(<ListViewport label="Test records" resetKey={key}><button>{text}</button></ListViewport>));
    };
    await render("page-1", "Select record");
    const viewport = host.querySelector<HTMLElement>('[role="region"]')!;
    expect(viewport.getAttribute("aria-label")).toBe("Test records");
    expect(viewport.tabIndex).toBe(0);
    viewport.scrollTop = 280;
    await render("page-1", "Record selected");
    expect(viewport.scrollTop).toBe(280);
    await render("page-1-active-filter", "Active record");
    expect(viewport.scrollTop).toBe(0);
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
