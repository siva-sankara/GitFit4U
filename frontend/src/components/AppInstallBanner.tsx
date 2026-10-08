import { useEffect, useRef, useState, type ReactNode } from "react";
import { Download, X } from "lucide-react";
import { Modal } from "./Modal";
import { beginInstallBanner, dismissInstall, installApp, installInstructions, usePwa } from "../services/pwa";
import "../styles/pwa.css";

export function AppInstallBanner() {
  const pwa = usePwa();
  const [instructions, setInstructions] = useState(false);
  const busy = pwa.installState === "prompting";
  const eligible = pwa.mobileInstallEligible && !pwa.installed && !pwa.dismissed && !pwa.bannerExpired;
  useEffect(() => {
    if (!eligible) return;
    beginInstallBanner();
    const resume = () => beginInstallBanner();
    document.addEventListener("visibilitychange", resume);
    return () => document.removeEventListener("visibilitychange", resume);
  }, [eligible]);

  return <>
    {eligible && pwa.bannerStartedAt !== null && <aside className="app-install-banner" aria-label="Install GETFIT4U">
      <img src="/brand/app-icon-192.png" width="32" height="32" alt="" />
      <span>Get the GETFIT4U app</span>
      <button className="install-banner-action" disabled={busy} onClick={async () => {
        if (!pwa.installAvailable) { setInstructions(true); return; }
        await installApp();
      }}><Download size={16} aria-hidden="true" />{busy ? "Opening…" : pwa.installAvailable ? "Install" : "How to install"}</button>
      <button className="install-banner-dismiss" aria-label="Dismiss installation banner" onClick={dismissInstall}><X size={18} aria-hidden="true" /></button>
      {pwa.error && <small role="alert">{pwa.error}</small>}
    </aside>}
    {instructions && !pwa.installed && <Modal open title="How to install GETFIT4U" onClose={() => setInstructions(false)}>
      {pwa.installAvailable && <button className="btn btn-primary" onClick={() => { void installApp(); setInstructions(false); }}>Install GETFIT4U</button>}
      <p>{installInstructions()}</p>
      <p>The app needs a connection for attendance, bookings, payments and messages.</p>
      <button className="btn btn-primary" onClick={() => setInstructions(false)}>Got it</button>
    </Modal>}
  </>;
}

export function AppHeader({ children }: { children: ReactNode }) {
  const element = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const header = element.current;
    if (!header) return;
    const measure = () => document.documentElement.style.setProperty("--app-header-height", `${header.getBoundingClientRect().height}px`);
    measure();
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : undefined;
    observer?.observe(header);
    window.addEventListener("resize", measure);
    return () => { observer?.disconnect(); window.removeEventListener("resize", measure); document.documentElement.style.removeProperty("--app-header-height"); };
  }, []);
  return <div ref={element} className="site-header-stack"><AppInstallBanner />{children}</div>;
}
