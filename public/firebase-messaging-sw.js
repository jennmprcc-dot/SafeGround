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
  const target = (data && data.data && data.data.url) || "/";
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
        // If the app is already on the target page, just bring it forward.
        if (here !== "" && here === target.split("?")[0]) return client.focus();
        // Otherwise route the open app to the notification's page (an app
        // open on an old page would otherwise stay there after the tap).
        if ("navigate" in client && typeof client.navigate === "function") {
          const absolute = self.location.origin + target;
          return Promise.all([client.navigate(absolute), client.focus()]).then(() => undefined);
        }
        if ("focus" in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow(target);
      return undefined;
    }),
  );
});
