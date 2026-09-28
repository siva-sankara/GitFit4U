// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { expect, it, vi } from "vitest";
import { BackIconButton, BackIconLink } from "./BackIconControl";

it("renders links and buttons as labelled icon-only back controls", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement("div");
  const root = createRoot(host);
  const back = vi.fn();
  try {
    await act(async () =>
      root.render(
        <MemoryRouter>
          <BackIconLink to="/previous" label="Back to previous screen" />
          <BackIconButton label="Back to conversations" onClick={back} />
        </MemoryRouter>,
      ),
    );
    const controls = [...host.querySelectorAll("a,button")];
    expect(controls).toHaveLength(2);
    expect(controls.map((control) => control.textContent)).toEqual(["", ""]);
    expect(controls.map((control) => control.getAttribute("aria-label"))).toEqual([
      "Back to previous screen",
      "Back to conversations",
    ]);
    expect(controls.every((control) => control.querySelector("svg"))).toBe(true);
    controls[1].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(back).toHaveBeenCalledOnce();
  } finally {
    await act(async () => root.unmount());
  }
});
