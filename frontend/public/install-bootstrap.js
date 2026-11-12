// Capture before the application bundle loads. Keep this event in memory only.
(() => {
  if (window.__gfuInstallCapture) return;
  const capture = window.__gfuInstallCapture = { prompt: null, installed: false };
  const notify = () => window.dispatchEvent(new Event("gfu-install-capture"));
  window.addEventListener("beforeinstallprompt", event => {
    event.preventDefault();
    if (!capture.installed) capture.prompt = event;
    notify();
  });
  window.addEventListener("appinstalled", () => {
    capture.prompt = null;
    capture.installed = true;
    notify();
  });
})();
