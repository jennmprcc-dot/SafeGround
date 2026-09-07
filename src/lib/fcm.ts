/**
 * Client-side Firebase Messaging (web push) via the COMPAT CDN.
 *
 * NO npm firebase (~127MB) — we load the two compat scripts straight from
 * Google's gstatic CDN (firebase-app-compat + firebase-messaging-compat) and
 * use window.firebase. This keeps the bundle byte-free of Firebase and works
 * on the free tier. iOS Safari web push requires the site installed to the
 * home screen (Add to Home Screen) before PushManager is available.
 *
 * Flow:
 *  1. GET /api/push-config → public web config (+ projectId for the SW URL)
 *  2. loadSW() → register /firebase-messaging-sw.js (public dir, browser-only)
 *  3. request Notification permission (user taps Allow — the ONLY consent)
 *  4. getToken() → FCM registration token for this device
 *  5. POST /api/push/register with {phone, token} → stored server-side
 */
import type { PushPublicConfig } from "~/lib/pushServer";

const APP_COMPAT_URL = "https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js";
const MESSAGING_COMPAT_URL = "https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js";

/* ── global types (the compat scripts declare window.firebase) ───── */
interface FirebaseAppCompat {
  initializeApp: (config: Record<string, string>) => unknown;
}
/**
 * In the compat SDK (firebase-app-compat + firebase-messaging-compat from
 * gstatic), getToken/onMessage/deleteToken are METHODS ON THE MESSAGING
 * INSTANCE (fb.messaging(app)) — never on the global `firebase` object.
 * window.firebase only carries initializeApp + messaging (+ apps).
 */
interface MessagingCompat {
  messaging: (app: unknown) => unknown;
  getToken?: (opts: { vapidKey: string }) => Promise<string>;
  onMessage?: (cb: (payload: { notification?: { title?: string; body?: string } }) => void) => void;
  deleteToken?: () => Promise<boolean>;
}
interface FirebaseCompat {
  apps?: unknown[];
  initializeApp?: FirebaseAppCompat["initializeApp"];
  messaging?: MessagingCompat["messaging"];
}
declare global {
  interface Window {
    firebase?: FirebaseCompat;
  }
}

export interface FcmStatus {
  supported: boolean;
  permission: NotificationPermission | "unsupported" | "unknown";
  token: string | null;
  registered: boolean;
  message: string;
}

/* ── script loader (Promise, deduped, cross-origin safe) ─────────── */
const loaded = new Map<string, Promise<void>>();
function loadScript(src: string): Promise<void> {
  const existing = loaded.get(src);
  if (existing) return existing;
  const p = new Promise<void>((resolve, reject) => {
    const el = document.createElement("script");
    el.src = src;
    el.onload = () => resolve();
    el.onerror = () => reject(new Error(`failed to load ${src}`));
    document.head.appendChild(el);
  });
  loaded.set(src, p);
  return p;
}

/* ── public config fetch (never touches the service account) ─────── */
export async function fetchPushConfig(): Promise<PushPublicConfig> {
  const res = await fetch("/api/push-config", { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error("push config unavailable");
  return (await res.json()) as PushPublicConfig;
}

export function pushSupported(): boolean {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window;
}

/* ── service worker registration (browser-only file, public dir) ───
 * Real errors SURFACE (never swallowed): /push-test shows the message so a
 * broken worker is diagnosable instead of silently returning null. */
export async function registerPushSW(): Promise<ServiceWorkerRegistration> {
  if (!("serviceWorker" in navigator)) throw new Error("This browser doesn't support service workers.");
  if (!("PushManager" in window)) throw new Error("Push isn't available until SafeGround is installed to the home screen.");
  if (navigator.serviceWorker.controller) return await navigator.serviceWorker.ready;
  let reg: ServiceWorkerRegistration;
  try {
    reg = await navigator.serviceWorker.register("/firebase-messaging-sw.js");
  } catch (e) {
    throw new Error(
      `The notification worker didn't register: ${e instanceof Error ? e.message : "unknown error"}.`,
    );
  }
  return (await navigator.serviceWorker.ready) ?? reg;
}

/* ── full registration flow. phone = sender/owner identity (digits) ── */
export async function registerDevicePush(phone: string, deviceLabel?: string): Promise<FcmStatus> {
  if (!pushSupported()) {
    return {
      supported: false,
      permission: "unsupported",
      token: null,
      registered: false,
      message: "This browser doesn't support notifications — on iPhone, install SafeGround from the share button first.",
    };
  }
  const config = await fetchPushConfig();
  if (!config.configured) {
    return {
      supported: true,
      permission: Notification.permission,
      token: null,
      registered: false,
      message: "Push isn't configured on this environment yet.",
    };
  }
  await loadScript(APP_COMPAT_URL);
  await loadScript(MESSAGING_COMPAT_URL);
  const fb = window.firebase;
  // COMPAT GUARD: the compat SDK only exposes initializeApp + messaging on the
  // global; getToken lives on the messaging instance. Checking fb.getToken here
  // ALWAYS failed → the permanent "Firebase scripts failed to load." message.
  if (!fb?.initializeApp || !fb.messaging) {
    return { supported: true, permission: "unknown", token: null, registered: false, message: "Firebase scripts failed to load." };
  }
  // vapidKey belongs to getToken(), not initializeApp() — the compat app is
  // initialized with the standard web-config keys only.
  const app = fb.initializeApp({
    apiKey: config.apiKey,
    authDomain: config.authDomain,
    projectId: config.projectId,
    appId: config.appId,
    messagingSenderId: config.messagingSenderId,
  });
  const messagingObj = fb.messaging(app);
  const m = messagingObj as unknown as MessagingCompat;
  if (!m.getToken) {
    return { supported: true, permission: "unknown", token: null, registered: false, message: "Firebase scripts failed to load." };
  }
  if (m.onMessage) {
    m.onMessage((payload) => {
      const n = payload.notification;
      if (n?.title && typeof Notification !== "undefined" && Notification.permission === "granted") {
        try {
          new Notification(n.title, { body: n.body ?? "" });
        } catch {
          /* desktop in-page notification is best-effort */
        }
      }
    });
  }
  if (Notification.permission !== "granted") {
    const requested = await Notification.requestPermission();
    if (requested !== "granted") {
      return { supported: true, permission: requested, token: null, registered: false, message: "Notifications are off — you can allow them in your browser or phone settings." };
    }
  }
  await registerPushSW();
  const token = await m.getToken({ vapidKey: config.vapidKey });
  if (!token) {
    return { supported: true, permission: "granted", token: null, registered: false, message: "No push token came back yet — try again in a few seconds." };
  }
  const reg = await fetch("/api/push/register", {
    method: "POST",
    headers: { "content-type": "application/json", "x-sg-phone": phone.replace(/[^0-9+]/g, "") },
    body: JSON.stringify({ phone: phone.replace(/[^0-9]/g, ""), token, deviceLabel: deviceLabel ?? undefined }),
  });
  const json = (await reg.json()) as { ok?: boolean; error?: string };
  return {
    supported: true,
    permission: "granted",
    token,
    registered: json.ok === true,
    message: json.ok ? "This phone can now receive SafeGround notifications." : json.error ?? "Token saved locally but not registered server-side.",
  };
}