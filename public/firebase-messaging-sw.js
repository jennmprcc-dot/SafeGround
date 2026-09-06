/* SafeGround Firebase Messaging service worker (browser-only).
 *
 * The client loads the two compat scripts from gstatic into the tab; this
 * worker receives the push messages and shows a system notification. It does
 * NOT import any Firebase library — FCM's token is minted in the page context
 * via firebase-messaging-compat, and the worker only needs the push event
 * handler + click-through navigation (FCM delivers the payload to the
 * registered worker directly). Runs only when the site is installed / the
 * browser allows push. */
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { notification: { title: "SafeGround", body: "" } };
  }
  const n = (data as { notification?: { title?: string; body?: string } }).notification ?? {};
  const title = n.title ?? "SafeGround";
  const body = n.body ?? "";
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: "/icon-192.png",
      badge: "/favicon.png",
      data: { url: "/" },
    }),
  );
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && (event.notification.data as { url?: string }).url) || "/";
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if ("focus" in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow(target);
      return undefined;
    }),
  );
});