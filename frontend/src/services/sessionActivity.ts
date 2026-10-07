import { flushPendingLogout, hasPendingLogout, hasPersistedSession, refreshSession } from "./apiClient";

const activityIntervalMs = 60_000;

/** Renew on visits and interaction, never on an idle timer or background polling. */
export function trackSessionActivity(reconcile: () => Promise<unknown>) {
  let timer: number | undefined;
  let lastAttempt = -Infinity;
  let running = false;
  let pending = false;
  let revalidate = false;
  let disposed = false;

  const schedule = () => {
    if (disposed || running || timer !== undefined || !pending) return;
    timer = window.setTimeout(() => void flush(), Math.max(0, activityIntervalMs - (Date.now() - lastAttempt)));
  };
  const flush = async () => {
    timer = undefined;
    if (disposed || document.visibilityState === "hidden") return;
    running = true;
    pending = false;
    lastAttempt = Date.now();
    const shouldRevalidate = revalidate;
    revalidate = false;
    try {
      if (hasPendingLogout()) {
        await flushPendingLogout();
        return;
      }
      if (!hasPersistedSession()) return;
      await refreshSession({ activity: true });
      if (!disposed && shouldRevalidate) await reconcile();
    } catch {
      // Network errors keep recovery available. Definitive session rejection is
      // handled by apiClient; activity tracking must not force a local logout.
    } finally {
      running = false;
      schedule();
    }
  };
  const activity = () => {
    if (document.visibilityState === "hidden" || (!hasPersistedSession() && !hasPendingLogout())) return;
    pending = true;
    schedule();
  };
  const resume = () => { revalidate = true; activity(); };
  const visible = () => { if (document.visibilityState === "visible") resume(); };
  const interactions = ["pointerdown", "keydown", "scroll", "touchstart"] as const;
  const resumes = ["pageshow", "online", "focus"] as const;
  for (const event of interactions) window.addEventListener(event, activity, { passive: true, capture: true });
  for (const event of resumes) window.addEventListener(event, resume);
  document.addEventListener("visibilitychange", visible);
  resume();
  return () => {
    disposed = true;
    window.clearTimeout(timer);
    for (const event of interactions) window.removeEventListener(event, activity, true);
    for (const event of resumes) window.removeEventListener(event, resume);
    document.removeEventListener("visibilitychange", visible);
  };
}
