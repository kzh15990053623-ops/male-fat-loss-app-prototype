const CACHE_NAME = "fitness-fat-loss-app-shell-v17";
const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./src/app.js?v=20260906-1",
  "./src/app-utils.js",
  "./src/app-state.js",
  "./src/app-data.js",
  "./src/app-storage.js",
  "./src/app-sync.js",
  "./src/app-logic.js",
  "./src/app-render.js",
  "./src/render/shared.js",
  "./src/render/pages/home.js",
  "./src/render/pages/diet.js",
  "./src/render/pages/training.js",
  "./src/render/pages/data.js",
  "./src/render/pages/profile.js",
  "./src/app-actions.js",
  "./src/actions/services.js",
  "./src/actions/meal.js",
  "./src/actions/auth.js",
  "./src/actions/settings.js",
  "./src/actions/training.js",
  "./src/actions/home.js",
  "./src/styles.css?v=20260906-1",
  "./src/styles/tokens.css",
  "./src/styles/base.css",
  "./src/styles/components.css",
  "./src/styles/pages.css",
  "./src/app-icon.svg",
  "./src/app-icon-192.png",
  "./src/app-icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);

  if (request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(async () => {
        const cache = await caches.open(CACHE_NAME);
        const appShellUrl = new URL("./index.html", self.registration.scope).href;
        return cache.match(appShellUrl);
      }),
    );
    return;
  }

  event.respondWith(
    fetch(request)
      .then((response) => response)
      .catch(() => caches.match(request)),
  );
});
