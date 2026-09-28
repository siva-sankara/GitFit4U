import { useEffect, useState } from "react";

export function useMobileKeyboard() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    let expandedHeight = viewport.height;
    const check = () => {
      const active = document.activeElement;
      const editing = active instanceof HTMLElement && Boolean(active.closest('input,textarea,[contenteditable="true"]'));
      if (!editing) expandedHeight = Math.max(expandedHeight, viewport.height);
      setOpen(editing && expandedHeight - viewport.height > 120);
    };
    const rotate = () => { expandedHeight = viewport.height; check(); };
    viewport.addEventListener("resize", check);
    document.addEventListener("focusin", check);
    document.addEventListener("focusout", check);
    window.addEventListener("orientationchange", rotate);
    return () => {
      viewport.removeEventListener("resize", check);
      document.removeEventListener("focusin", check);
      document.removeEventListener("focusout", check);
      window.removeEventListener("orientationchange", rotate);
    };
  }, []);
  return open;
}
