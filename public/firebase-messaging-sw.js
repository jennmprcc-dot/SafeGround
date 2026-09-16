/* SafeGround Firebase Messaging service worker (browser-only).
 *
 * The Firebase-documented worker: it loads the compat SDK itself via
 * importScripts — SAME-ORIGIN copies vendored at /firebase/ (Safari service
 * worker rules require the script + its imports to be same-origin; the
 * gstatic CDN scripts fail registration with "failed to register for scope
 * Cloud Messaging with script"). The page context ALSO loads the same SDK
 * version for getToken(); the registration token is minted there, and FCM
 * delivers background pushes to THIS registered worker, which shows the
 * system notification via onBackgroundMessage. Tapping opens the target.
 *
 * SDK version pinned to match src/lib/fcm.ts (firebasejs 10.14.1).
 * Vendored files: public/firebase/app-compat.js + messaging-compat.js
 * (copied verbatim from gstatic, sourceMappingURL comment stripped).
 * Runs only when the site is installed / the browser allows push. */
importScripts("/firebase/app-compat.js");
importScripts("/firebase/messaging-compat.js");

const SW_VERSION = "sg-fcm-sw/10.14.1";

let messaging = null;
try {
  // The public web config is fetched at install time (never the service
  // account — public keys only, same values /api/push-config serves).
  // NOTE: importScripts is synchronous but fetch is not — the config arrives
  // async; onBackgroundMessage is wired once initializeApp succeeds.
  fetch("/api/push-config", { headers: { accept: "application/json" } })
    .then((res) => (res.ok ? res.json() : null))
    .then((cfg) => {
      if (!cfg || !cfg.configured) return;
      try {
        firebase.initializeApp({
          apiKey: cfg.apiKey,
          authDomain: cfg.authDomain,
          projectId: cfg.projectId,
          appId: cfg.appId,
          messagingSenderId: cfg.messagingSenderId,
        });
        messaging = firebase.messaging();
        messaging.onBackgroundMessage((payload) => {
          const n = (payload && payload.notification) || {};
          const title = n.title || "SafeGround";
          const body = n.body || "";
          const target =
            (payload && payload.fcmOptions && payload.fcmOptions.link) ||
            (payload && payload.data && payload.data.url) ||
            "/";
          return self.registration.showNotification(title, {
            body,
            icon: "/icon-192.png",
            badge: "/favicon.png",
            data: { url: target },
          });
        });
      } catch (err) {
        // Init failure: fall back to the plain push handler below so a
        // notification still shows instead of silence.
      }
    })
    .catch(() => {
      /* offline at install — the plain push handler below still shows */
    });
} catch (err) {
  /* importScripts/SDK failure — the plain push handler below still shows */
}

// Fallback plain-push handler: if the compat SDK path above isn't ready
// (offline install, init failure), a data-only push still surfaces calmly
// instead of vanishing. onBackgroundMessage takes over once initialized.
self.addEventListener("push", (event) => {
  if (messaging) return; // FCM SDK handles it — avoid a double notification
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (err) {
    data = { notification: { title: "SafeGround", body: "" } };
  }
  const n = (data && data.notification) || {};
  const title = n.title || "SafeGround";
  const body = n.body || "";
  // Same target resolution as the SDK path above (fcm_options.link first) so a
  // deep link like /checkin?focus=checkin:<id> still reaches the tap handler.
  const target =
    (data && data.fcm_options && data.fcm_options.link) ||
    (data && data.data && data.data.url) ||
    "/";
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: "/icon-192.png",
      badge: "/favicon.png",
      data: { url: target },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const raw = (event.notification.data && event.notification.data.url) || "/";
  // Only open same-origin app paths — never follow an arbitrary URL.
  const target = typeof raw === "string" && raw.startsWith("/") ? raw : "/";
  const targetPath = target.split("?")[0];
  const absolute = self.location.origin + target;
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        // client.url is the full URL — compare its path to the target path.
        let here = "";
        try {
          here = new URL(client.url).pathname;
        } catch (err) {
          here = "";
        }
        if (here !== "" && here === targetPath) {
          // Same page. Plain page targets just come forward. A tap that carries
          // a query (e.g. /checkin?focus=checkin:<id>) must still be delivered:
          // an app already sitting on /checkin has no way to know a FRESH
          // check-in arrived, so navigate it to the deep link — the app then
          // scrolls the friends map in and highlights the new pin. Only when
          // the app is already on that exact URL do we just focus it.
          if (!target.includes("?") || client.url === absolute) return client.focus();
          if ("navigate" in client && typeof client.navigate === "function") {
            return Promise.all([client.navigate(absolute), client.focus()]).then(() => undefined);
          }
          return client.focus();
        }
        // Otherwise route the open app to the notification's page (an app
        // open on an old page would otherwise stay there after the tap).
        if ("navigate" in client && typeof client.navigate === "function") {
          return Promise.all([client.navigate(absolute), client.focus()]).then(() => undefined);
        }
        if ("focus" in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow(target);
      return undefined;
    }),
  );
});

/* ── PWA offline resources (PR-D) ───────────────────────────────────
 * OPTION B, ONE service worker: the SAME worker above also precaches the
 * bundled offline resources JSON so the Help page still shows real Marin
 * listings with no connection. Push + notificationclick handlers above are
 * UNCHANGED. No other routes/assets change caching behavior.
 *
 * Strategy: network-first for the resources fetch — always try the network,
 * serve the precached copy ONLY when the network fails (offline). We never
 * serve stale cache while online, and we never write to the cache on success
 * (the cache stays the bundled snapshot, so "Last synced" is honest).
 */
const RESOURCES_CACHE = "sg-resources-v1";
const RESOURCES_URL = "/resources-fallback.json";

// Install: precache the bundled offline resources JSON. Push wiring is
// untouched; we do NOT skipWaiting so the new worker activates on next load
// just like today.
self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(RESOURCES_CACHE).then((cache) => cache.add(RESOURCES_URL)));
});

// Activate: drop any older sg-resources-* cache so the versioned cache stays
// single and the bundledAt snapshot stays current.
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k.startsWith("sg-resources-") && k !== RESOURCES_CACHE)
          .map((k) => caches.delete(k)),
      ),
    ),
  );
});

// Network-first ONLY for the bundled resources JSON (same-origin GET). All
// other requests pass through untouched. On network failure (offline) we fall
// back to the precached copy; a non-ok response is treated as a miss so the
// user still sees the saved list rather than an error page.
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (event.request.method !== "GET") return;
  if (url.pathname !== RESOURCES_URL) return;
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        if (res && res.ok) return res;
        throw new Error("resources fetch not ok");
      })
      .catch(() =>
        caches
          .open(RESOURCES_CACHE)
          .then((cache) => cache.match(RESOURCES_URL))
          .then((cached) => cached || Response.error()),
      ),
  );
});
