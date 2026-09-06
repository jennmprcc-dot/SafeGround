/**
 * Firebase push stub (Wave 2a) — env-var placeholders only, nothing blocks.
 *
 * The in-app inbox + toast is the working notification surface for this wave;
 * real FCM push arrives in a later delegation (outreach dashboard wave). This
 * module exists so every call site already has the right shape and the project
 * never pays for a service. All keys come from platform env vars (VITE_* —
 * gitignored, never committed).
 *
 * Docs: https://firebase.google.com/docs/cloud-messaging
 */
import type { AlertRow } from "~/lib/alerts";

export interface PushEnv {
  /** Firebase web config (public, safe to ship) — placeholder keys are empty strings. */
  apiKey: string;
  authDomain: string;
  projectId: string;
  messagingSenderId: string;
  appId: string;
  /** FCM web push registration (VAPID public key) when a later wave enables web push. */
  vapidKey: string;
}

export function pushEnv(): PushEnv {
  return {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY ?? "",
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ?? "",
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID ?? "",
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? "",
    appId: import.meta.env.VITE_FIREBASE_APP_ID ?? "",
    vapidKey: import.meta.env.VITE_FIREBASE_VAPID_KEY ?? "",
  };
}

/** True when the platform env provides real Firebase credentials. */
export function pushConfigured(): boolean {
  const e = pushEnv();
  return Boolean(e.apiKey && e.projectId && e.messagingSenderId);
}

/**
 * Best-effort push: no-op when unconfigured (the in-app inbox + toast carries
 * the notification). Returns a calm status string for debug labels — never
 * throws, never blocks the alert flow.
 */
export async function notifyAlert(_a: AlertRow): Promise<"sent" | "unconfigured" | "unsupported"> {
  if (!pushConfigured()) return "unconfigured";
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return "unsupported";
  // Real registration lands with the FCM wave; until then, in-app surface only.
  return "unsupported";
}

/** Local-only delivery reminder: "in-app notification surface is on" indicator. */
export function inboxBellEnabled(): boolean {
  return true;
}