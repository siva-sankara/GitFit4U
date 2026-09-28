// Cache only the public offline document. Never cache authenticated HTML,
// API responses, uploads, signed media, invoices or conversation contents.
const CACHE_NAME = "getfit4u-offline-v3";
const OFFLINE_URL = "/offline.html";
self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.add(OFFLINE_URL)));
  // Updates wait until the user saves their work and explicitly reloads.
});
self.addEventListener("message", event => {
  if (event.data?.type === "GETFIT4U_APPLY_UPDATE") void self.skipWaiting();
});
self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys
    .filter(key => key !== CACHE_NAME && (key.startsWith("getfit4u-shell-") || key.startsWith("getfit4u-offline-")))
    .map(key => caches.delete(key)))));
  // Do not claim/reload other open tabs or touch Firebase's separate scope.
});
self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin ||
      event.request.mode !== "navigate" || url.pathname.startsWith("/api/")) return;
  event.respondWith(fetch(event.request).catch(async () => {
    const offline = await caches.match(OFFLINE_URL);
    return new Response(offline ? await offline.text() : "GETFIT4U is offline. Reconnect and reload to continue.", {
      status: 503,
      headers: { "Content-Type": offline ? "text/html; charset=utf-8" : "text/plain; charset=utf-8", "Cache-Control": "no-store" },
    });
  }));
});
