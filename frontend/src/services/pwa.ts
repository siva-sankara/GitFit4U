import { useSyncExternalStore } from "react";

interface InstallPrompt extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}
interface PwaState {
  installState: "checking" | "ready" | "prompting" | "dismissed" | "installed" | "manual" | "error";
  installed: boolean;
  installAvailable: boolean;
  dismissed: boolean;
  online: boolean;
  updateAvailable: boolean;
  error: string | null;
  mobileInstallEligible: boolean;
  bannerStartedAt: number | null;
  bannerExpired: boolean;
}
export const installSessionKey = "gfu_install_session_v1";
declare global {
  interface Window { __gfuInstallCapture?: { prompt: InstallPrompt | null; installed: boolean } }
}
export const installBannerDuration = 120_000;
const listeners = new Set<() => void>();
let deferredPrompt: InstallPrompt | null = null;
let registration: ServiceWorkerRegistration | null = null;
let started = false;
let reloadRequested = false;
let bannerTimer: ReturnType<typeof setTimeout> | undefined;
let state: PwaState = { installState: "checking", installed: false, installAvailable: false, dismissed: false, online: true, updateAvailable: false, error: null,
  mobileInstallEligible: false, bannerStartedAt: null, bannerExpired: false };
function update(patch: Partial<PwaState>) {
  state = { ...state, ...patch };
  listeners.forEach(listener => listener());
}
export function isInstalled() {
  return Boolean(window.matchMedia?.("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone);
}
export function installInstructions(userAgent = navigator.userAgent, touchPoints = navigator.maxTouchPoints) {
  if (/iPad|iPhone|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && touchPoints > 1))
    return "In Safari, open Share, choose Add to Home Screen, enable Open as Web App if shown, then Add. Open GETFIT4U from that icon.";
  if (/Android/.test(userAgent))
    return "Open your browser menu and choose Install app or Add to Home screen. If unavailable, open GETFIT4U in Chrome over HTTPS.";
  return "Use your browser's Install app icon or menu. If unavailable, use a browser that supports installation, such as Chrome or Edge, over HTTPS.";
}
export function dismissInstall() {
  update({ dismissed: true, installState: state.installed ? "installed" : "dismissed" });
  persistInstallSession();
}
function persistInstallSession() {
  try { sessionStorage.setItem(installSessionKey, JSON.stringify({ startedAt: state.bannerStartedAt, dismissed: state.dismissed })); }
  catch { /* In-memory session state still prevents repeated banners. */ }
}
function scheduleBannerExpiry() {
  if (bannerTimer) clearTimeout(bannerTimer);
  if (state.bannerStartedAt === null) return;
  const remaining = state.bannerStartedAt + installBannerDuration - Date.now();
  if (remaining <= 0) { update({ bannerExpired: true }); return; }
  bannerTimer = setTimeout(() => update({ bannerExpired: true }), remaining);
}
function mobileInstallEligible() {
  const mobile = /Android|iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1) ||
    window.matchMedia?.("(max-width: 1024px) and (pointer: coarse)").matches;
  return Boolean(mobile && window.isSecureContext && "serviceWorker" in navigator && !isInstalled());
}
export function beginInstallBanner() {
  if (!state.mobileInstallEligible || state.installed || state.dismissed || state.bannerExpired || document.visibilityState === "hidden") return;
  if (state.bannerStartedAt === null) {
    update({ bannerStartedAt: Date.now() });
    persistInstallSession();
  }
  scheduleBannerExpiry();
}
export async function installApp() {
  const prompt = deferredPrompt;
  if (!prompt || state.installed || state.installState === "prompting") return;
  deferredPrompt = null;
  if (window.__gfuInstallCapture) window.__gfuInstallCapture.prompt = null;
  update({ installState: "prompting", installAvailable: false, error: null });
  try {
    await prompt.prompt();
    const choice = await prompt.userChoice;
    if (choice.outcome === "dismissed") dismissInstall();
    else if (!state.installed) update({ installState: "manual" });
    // Only appinstalled/display-mode confirms an installed application.
  } catch {
    update({ installState: "error", error: "Installation could not open. Use your browser's installation menu." });
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
  let bannerStartedAt: number | null = null;
  try {
    const saved = JSON.parse(sessionStorage.getItem(installSessionKey) || "null");
    dismissed = saved?.dismissed === true;
    if (typeof saved?.startedAt === "number" && Number.isFinite(saved.startedAt) && saved.startedAt <= Date.now())
      bannerStartedAt = saved.startedAt;
  } catch { /* Storage is optional. */ }
  update({ installState: isInstalled() ? "installed" : dismissed ? "dismissed" : "manual", installed: isInstalled(), dismissed, online: navigator.onLine, bannerStartedAt,
    mobileInstallEligible: mobileInstallEligible(), bannerExpired: bannerStartedAt !== null && Date.now() - bannerStartedAt >= installBannerDuration });
  scheduleBannerExpiry();
  const installed = () => {
    deferredPrompt = null;
    if (window.__gfuInstallCapture) window.__gfuInstallCapture.prompt = null;
    update({ installState: "installed", installed: true, dismissed: true, installAvailable: false, mobileInstallEligible: false, error: null });
    persistInstallSession();
  };
  const capturePrompt = (event: InstallPrompt) => {
    event.preventDefault();
    if (state.installed || isInstalled()) return;
    deferredPrompt = event;
    update({ installState: "ready", installAvailable: true, error: null });
  };
  if (window.__gfuInstallCapture) {
    const syncCapture = () => {
      const capture = window.__gfuInstallCapture!;
      if (capture.installed || isInstalled()) installed();
      else if (capture.prompt) capturePrompt(capture.prompt);
    };
    window.addEventListener("gfu-install-capture", syncCapture);
    syncCapture();
  } else {
    // Test harnesses and older cached entry documents may not have the bootstrap.
    window.addEventListener("beforeinstallprompt", event => capturePrompt(event as InstallPrompt));
    window.addEventListener("appinstalled", installed);
  }
  window.matchMedia?.("(display-mode: standalone)").addEventListener?.("change", () => {
    if (isInstalled()) installed();
    else update({ installed: false, mobileInstallEligible: mobileInstallEligible(), installState: deferredPrompt ? "ready" : "manual" });
  });
  window.addEventListener("online", () => update({ online: true }));
  window.addEventListener("offline", () => update({ online: false }));
  window.addEventListener("resize", () => update({ mobileInstallEligible: mobileInstallEligible() }));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") scheduleBannerExpiry();
  });
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
  return useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }, getPwaSnapshot);
}
export function getPwaSnapshot(): Readonly<PwaState> { return state; }
