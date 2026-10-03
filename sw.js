const CACHE_NAME = "fitness-fat-loss-app-shell-v31";
const APP_SHELL = [
  "./src/render/records.js",
  "./src/render/product-info.js",
  "./src/release.js",
  "./src/meal-entries.js",
  "./src/state-contract.js",
  "./src/history-store.js",
  "./src/actions/records.js",
  "./src/actions/product-support.js",
  "./src/actions/account-recovery.js",
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./src/app.js?v=20261004-maturity-1",
  "./src/app-utils.js",
  "./src/app-state.js",
  "./src/app-data.js",
  "./src/app-storage.js",
  "./src/native-runtime.js",
  "./src/native-cloud.js",
  "./src/render/native-cloud.js",
  "./src/app-sync.js",
  "./src/app-logic.js",
  "./src/settings-fields.js",
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
  "./src/meal-photo.js",
  "./src/actions/auth.js",
  "./src/actions/settings.js",
  "./src/actions/training.js",
  "./src/actions/home.js",
  "./src/styles.css?v=20261004-maturity-1",
  "./src/styles/tokens.css",
  "./src/styles/base.css",
  "./src/styles/components.css",
  "./src/styles/pages.css",
  "./src/styles/ink-jade-theme.css",
  "./src/app-icon.svg",
  "./src/app-icon-192.png",
  "./src/app-icon-512.png",
];

// New workers wait for every open tab to save drafts before activation.
let updateVote = null;
self.addEventListener("message", (event) => {
  const data = event.data || {};
  if (data.type === "PREPARE_UPDATE") {
    event.waitUntil(
      (async () => {
        const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
        const ids = new Set(clients.map((client) => client.id));
        if (!ids.size) return self.skipWaiting();
        const voteId = crypto.randomUUID();
        updateVote = { ids, source: event.source, voteId };
        clients.forEach((client) => client.postMessage({ type: "PREPARE_PWA_UPDATE", voteId }));
        setTimeout(() => {
          if (updateVote?.voteId === voteId) {
            updateVote.source?.postMessage({ type: "PWA_UPDATE_BLOCKED" });
            updateVote = null;
          }
        }, 10000);
      })(),
    );
  } else if (data.type === "PWA_UPDATE_VOTE" && updateVote && data.voteId === updateVote.voteId) {
    if (!data.ready) {
      updateVote.source?.postMessage({ type: "PWA_UPDATE_BLOCKED" });
      updateVote = null;
      return;
    }
    updateVote.ids.delete(event.source.id);
    if (!updateVote.ids.size) {
      updateVote = null;
      event.waitUntil(self.skipWaiting());
    }
  }
});
self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
});
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((key) => key.startsWith("fitness-fat-loss-app-shell-") && key !== CACHE_NAME).map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});
self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      // A generation's shell and modules are immutable together, including on
      // HTTP 500 and weak networks. Updating the worker replaces the generation.
      if (request.mode === "navigate") {
        const shell = await cache.match(new URL("./index.html", self.registration.scope).href);
        if (shell) return shell;
      }
      const cached = await cache.match(request);
      if (cached) return cached;
      return fetch(request);
    })(),
  );
});
