/* Minimal service worker — its only job is to satisfy the browser's
   "installable web app" requirement (manifest + SW that controls a page).
   It caches just the app shell so the page still opens if there's no
   connection; it never caches the live radio streams themselves. */

const CACHE_NAME = "radio-shell-v1";
const SHELL_FILES = [
  "./",
  "./index.html",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = event.request.url;

  // Never intercept audio streams or cross-origin API/CDN calls — only
  // serve the app shell itself from cache.
  if (event.request.method !== "GET" || !SHELL_FILES.some((f) => url.endsWith(f.replace("./", "")))) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
