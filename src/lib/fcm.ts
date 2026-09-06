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
interface MessagingCompat {
  messaging: (app: unknown) => unknown;
  getToken: (m: unknown) => Promise<string>;
  onMessage?: (m: unknown, cb: (payload: { notification?: { title?: string; body?: string } }) => void) => void;
}
interface FirebaseCompat {
  apps?: unknown[];
  initializeApp?: FirebaseAppCompat["initializeApp"];
  messaging?: MessagingCompat["messaging"];
  getToken?: MessagingCompat["getToken"];
  onMessage?: MessagingCompat["onMessage"];
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

/* ── service worker registration (browser-only file, public dir) ─── */
export async function registerPushSW(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) return null;
  if (!("PushManager" in window)) return null; // iOS Safari needs A2HS first
  try {
    if (navigator.serviceWorker.controller) return await navigator.serviceWorker.ready;
    const reg = await navigator.serviceWorker.register("/firebase-messaging-sw.js");
    return (await navigator.serviceWorker.ready) ?? reg;
  } catch {
    return null;
  }
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
  if (!fb?.initializeApp || !fb.messaging || !fb.getToken) {
    return { supported: true, permission: "unknown", token: null, registered: false, message: "Firebase scripts failed to load." };
  }
  const app = fb.initializeApp({
    apiKey: config.apiKey,
    authDomain: config.authDomain,
    projectId: config.projectId,
    appId: config.appId,
    messagingSenderId: config.messagingSenderId,
    vapidKey: config.vapidKey,
  });
  const messaging = fb.messaging(app);
  if (fb.onMessage) {
    fb.onMessage(messaging, (payload) => {
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
  const token = await fb.getToken(messaging);
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