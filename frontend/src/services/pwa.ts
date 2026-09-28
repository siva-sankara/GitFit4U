import { useSyncExternalStore } from "react";

interface InstallPrompt extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}
interface PwaState {
  installed: boolean;
  installAvailable: boolean;
  dismissed: boolean;
  online: boolean;
  updateAvailable: boolean;
  error: string | null;
}
const dismissalKey = "gfu_install_dismissed_until";
const listeners = new Set<() => void>();
let deferredPrompt: InstallPrompt | null = null;
let registration: ServiceWorkerRegistration | null = null;
let started = false;
let reloadRequested = false;
let state: PwaState = { installed: false, installAvailable: false, dismissed: false, online: true, updateAvailable: false, error: null };
function update(patch: Partial<PwaState>) {
  state = { ...state, ...patch };
  listeners.forEach(listener => listener());
}
export function isInstalled() {
  return Boolean(window.matchMedia?.("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone);
}
export function installInstructions(userAgent = navigator.userAgent, touchPoints = navigator.maxTouchPoints) {
  if (/iPad|iPhone|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && touchPoints > 1))
    return "In Safari, open Share, choose Add to Home Screen, then Add. Open GETFIT4U from that icon.";
  if (/Android/.test(userAgent))
    return "Open your browser menu and choose Install app or Add to Home screen. If unavailable, open GETFIT4U in Chrome over HTTPS.";
  return "Use your browser's Install app icon or menu. If unavailable, use a browser that supports installation, such as Chrome or Edge, over HTTPS.";
}
export function dismissInstall() {
  try { localStorage.setItem(dismissalKey, String(Date.now() + 30 * 24 * 60 * 60 * 1000)); } catch { /* Session choice still applies. */ }
  update({ dismissed: true });
}
export function restoreInstall() {
  try { localStorage.removeItem(dismissalKey); } catch { /* Storage is optional. */ }
  update({ dismissed: false, error: null });
}
export async function installApp() {
  const prompt = deferredPrompt;
  if (!prompt || state.installed) return;
  deferredPrompt = null;
  update({ installAvailable: false, error: null });
  try {
    await prompt.prompt();
    const choice = await prompt.userChoice;
    if (choice.outcome === "dismissed") dismissInstall();
    // Only appinstalled/display-mode confirms an installed application.
  } catch {
    update({ error: "Installation could not open. Use your browser's installation menu." });
  }
}
export function applyAppUpdate() {
  if (!registration?.waiting) return;
  reloadRequested = true;
  registration.waiting.postMessage({ type: "GETFIT4U_APPLY_UPDATE" });
}
export function startPwaLifecycle(registerWorker = import.meta.env.PROD) {
  if (started) return;
  started = true;
  let dismissed = false;
  try { dismissed = Number(localStorage.getItem(dismissalKey)) > Date.now(); } catch { /* Storage is optional. */ }
  update({ installed: isInstalled(), dismissed, online: navigator.onLine });
  window.addEventListener("beforeinstallprompt", event => {
    event.preventDefault();
    deferredPrompt = event as InstallPrompt;
    update({ installAvailable: true });
  });
  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    update({ installed: true, installAvailable: false, error: null });
  });
  window.matchMedia?.("(display-mode: standalone)").addEventListener?.("change", () => update({ installed: isInstalled() }));
  window.addEventListener("online", () => update({ online: true }));
  window.addEventListener("offline", () => update({ online: false }));
  if (!registerWorker || !window.isSecureContext || !("serviceWorker" in navigator)) return;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloadRequested) window.location.reload();
  });
  const register = async () => {
    try {
      registration = await navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
      const reflect = () => update({ updateAvailable: Boolean(registration?.waiting && navigator.serviceWorker.controller) });
      reflect();
      registration.addEventListener("updatefound", () => {
        registration?.installing?.addEventListener("statechange", reflect);
      });
      window.addEventListener("focus", () => { void registration?.update().catch(() => undefined); });
    } catch {
      update({ error: "App installation setup could not finish. Check your connection and reload to retry." });
    }
  };
  if (document.readyState === "complete") void register();
  else window.addEventListener("load", () => { void register(); }, { once: true });
}
export function usePwa() {
  return useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => state);
}
