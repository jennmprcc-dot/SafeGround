/**
 * SafeGround server-side Firebase push (owner green-lit 2026-09-06).
 *
 * The ONLY dispatch channel this app uses is FCM HTTP v1 — never SMS, never
 * 911, never an agency. This module is server-only (node:crypto + process.env):
 * it signs a JWT with the Firebase service-account private key, exchanges it
 * for a short-lived OAuth2 access token at Google's token endpoint, and posts
 * to `https://fcm.googleapis.com/v1/projects/<projectId>/messages:send`.
 *
 * SECURITY CONTRACT (non-negotiable):
 *  - The service account / private key is NEVER logged, echoed, or returned to
 *    the client. `/api/push-config` ships ONLY the public web-config subset.
 *  - Sends are gated server-side: a caller may only push to their OWN phone
 *    (owner test button), or a roster admin may push to roster recipients
 *    (peer-support request → the two admin phones, never anyone else).
 *  - Consent is device-level: only tokens the recipient phone explicitly
 *    registered (tap "Allow", then stored in push_tokens) are ever used.
 *
 * Free-tier note: this fetches tokens from Google's token endpoint per send
 * (cached for the token's lifetime) — no paid FCM tier involved.
 */
import { createPrivateKey, createSign } from "node:crypto";
import { sql } from "~/db";

/* ── Public web-config subset (safe to ship to the browser) ────────
 * These are the only Firebase values the client ever sees. The service
 * account lives exclusively in process.env.FIREBASE_SERVICE_ACCOUNT and
 * never crosses this module's return paths. */
export interface PushPublicConfig {
  configured: boolean;
  apiKey: string;
  authDomain: string;
  projectId: string;
  appId: string;
  messagingSenderId: string;
  vapidKey: string;
}
export function pushPublicConfig(): PushPublicConfig {
  const apiKey = process.env.FIREBASE_API_KEY ?? "";
  const authDomain = process.env.FIREBASE_AUTH_DOMAIN ?? "";
  const projectId = process.env.FIREBASE_PROJECT_ID ?? "";
  const appId = process.env.FIREBASE_APP_ID ?? "";
  // FIREBASE_MESSAGING_SENDER_ID is the canonical name (owner-direction); a
  // legacy misspelled FIREBASE_MESSENGER_SENDER_ID is honored as a fallback so
  // earlier-created Secrets still resolve until the owner renames them.
  const messagingSenderId = process.env.FIREBASE_MESSAGING_SENDER_ID ?? process.env.FIREBASE_MESSENGER_SENDER_ID ?? "";
  const vapidKey = process.env.FIREBASE_VAPID_KEY ?? "";
  return {
    configured: Boolean(apiKey && projectId && appId && messagingSenderId && vapidKey),
    apiKey,
    authDomain,
    projectId,
    appId,
    messagingSenderId,
    vapidKey,
  };
}

/* ── Roster (peer-support dispatch target, owner-directed 2026-09-06) ──
 * The peer-support request route must push ONLY to MPRCC's two admins,
 * Jenn + Bambi. These are the ONLY phones that path may ever target. */
export const PEER_SUPPORT_ADMIN_PHONES = ["14158797940", "14155249090"] as const;

/** Is this phone an ACTIVE roster admin? Server-side gate (never client trust). */
export async function isRosterAdmin(phone: string): Promise<boolean> {
  if (!phone) return false;
  try {
    const rows = (await sql()`
      select 1 from public.outreach_roster
      where phone = ${phone} and active and role = 'admin'
      limit 1`) as unknown as Array<Record<string, unknown>>;
    return rows.length > 0;
  } catch {
    return false;
  }
}

/* ── Service-account → OAuth2 access token ───────────────────────── */
interface ServiceAccount {
  client_email?: string;
  private_key?: string;
  project_id?: string;
}
interface CachedAccessToken {
  token: string;
  expiresAt: number; // epoch ms
}
let tokenCache: CachedAccessToken | null = null;

/**
 * Normalize a PEM private key via strict DER re-encode.
 *
 * The saved secret's body contains a literal "{ " paste artifact mid-base64,
 * and Buffer.from(body, "base64") SILENTLY DROPS invalid base64 chars — which
 * corrupts the DER decode and makes the re-encoded PEM fail OpenSSL with
 * BAD_BASE64_DECODE. Fix: strip ALL non-base64 noise, rebuild correct padding
 * (the body must be a clean multiple of 4 with only trailing '=') BEFORE
 * decoding, then decode to DER (the true key bytes — immune to wrapping
 * mangling) and re-encode canonical 64-col PEM. NEVER logs any part of the key.
 */
export function normalizePrivateKey(raw: string): string {  if (!/BEGIN [A-Z ]+PRIVATE KEY/i.test(raw)) return raw.trim();
  const body = raw
    .replace(/\r?\n/g, "")
    .replace(/\\n/g, "")
    .replace(/-{4,5}BEGIN (?:RSA |EC )?PRIVATE KEY-{4,5}/g, "")
    .replace(/-{4,5}END (?:RSA |EC )?PRIVATE KEY-{4,5}/g, "")
    .replace(/[^A-Za-z0-9+/=]/g, ""); // strips the "{ " artifact + all noise
  // Rebuild correct padding, THEN decode — Buffer.from for base64 drops invalid
  // chars, so the body must be a clean multiple of 4 with only trailing '='.
  const unpadded = body.replace(/=+$/, "");
  const padLen = (4 - (unpadded.length % 4)) % 4;
  const padded = unpadded + "=".repeat(padLen);
  const der = Buffer.from(padded, "base64");
  const b64 = der.toString("base64");
  const lines = b64.match(/.{1,64}/g) ?? [];
  return `-----BEGIN PRIVATE KEY-----\n${lines.join("\n")}\n-----END PRIVATE KEY-----\n`;
}

/** Parse the SA JSON defensively. NEVER logs any field of the account. */
function readServiceAccount(): ServiceAccount {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT ?? "";
  if (!raw) throw new Error("FIREBASE_SERVICE_ACCOUNT is not set — push send is unavailable until it is saved in Secrets.");
  const parsed = JSON.parse(raw) as ServiceAccount;
  if (!parsed.client_email || !parsed.private_key) {
    throw new Error("FIREBASE_SERVICE_ACCOUNT is missing client_email/private_key.");
  }
  return { ...parsed, private_key: normalizePrivateKey(parsed.private_key) };
}

const FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
/** base64url — Buffer handles the URL-safe alphabet + padding removal. */
const b64u = (input: string): string => Buffer.from(input).toString("base64url");

/** Sign a RS256 JWT with the service-account key and exchange it for an
 * OAuth2 access token (Google's standard service-account flow for FCM v1). */
export async function getFcmAccessToken(): Promise<string> {
  const now = Date.now();
  if (tokenCache && tokenCache.expiresAt > now + 60_000) return tokenCache.token;
  const sa = readServiceAccount();
  const iat = Math.floor(now / 1000);
  const exp = iat + 3600;
  const header = { alg: "RS256", typ: "JWT" };
  const claims = {
    iss: sa.client_email,
    scope: FCM_SCOPE,
    aud: TOKEN_URL,
    iat,
    exp,
  };
  const signingInput = `${b64u(JSON.stringify(header))}.${b64u(JSON.stringify(claims))}`;
  const key = createPrivateKey(sa.private_key!);
  const signature = createSign("RSA-SHA256").update(signingInput).sign(key, "base64url");
  const assertion = `${signingInput}.${signature}`;
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  const data = (await res.json()) as { access_token?: string; expires_in?: number; error?: string; error_description?: string };
  if (!res.ok || !data.access_token) {
    throw new Error(`Firebase auth token exchange failed (${res.status}) — check FIREBASE_SERVICE_ACCOUNT.`);
  }
  const expiresAt = Date.now() + (data.expires_in ? data.expires_in * 1000 : 3_600_000);
  tokenCache = { token: data.access_token, expiresAt };
  return data.access_token;
}

/* ── FCM HTTP v1 send ────────────────────────────────────────────── */
export interface FcmSendResult {
  /** first 12 chars of the token + mask — never the full token in logs/UI */
  to: string;
  status: "sent" | "unregistered" | "error";
  detail: string;
}
export interface PushMessage {
  token: string;
  title: string;
  body: string;
  /** Web-push click-through URL (opens the app when the notification is tapped). */
  link?: string;
  /** validate_only: true exercises the full auth + validation path without delivering. */
  validateOnly?: boolean;
}

/** POST one message via FCM HTTP v1. Throws ONLY on transport/auth-level
 * failures; per-token FCM rejections are returned as statuses. */
export async function sendFcmMessage(msg: PushMessage): Promise<FcmSendResult> {
  const projectId = process.env.FIREBASE_PROJECT_ID ?? "";
  if (!projectId) throw new Error("FIREBASE_PROJECT_ID is not set.");
  const accessToken = await getFcmAccessToken();
  const message: Record<string, unknown> = {
    token: msg.token,
    notification: { title: msg.title, body: msg.body },
  };
  if (msg.link) {
    message.webpush = { fcm_options: { link: msg.link } };
  }
  const body: Record<string, unknown> = msg.validateOnly ? { validate_only: true, message } : { message };
  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const masked = `${msg.token.slice(0, 12)}…`;
  if (res.ok) return { to: masked, status: "sent", detail: "delivered to FCM" };
  let detail = `FCM ${res.status}`;
  try {
    const data = (await res.json()) as { error?: { message?: string; status?: string } };
    if (data.error?.message) detail = data.error.message.slice(0, 200);
    if (res.status === 404 || /UNREGISTERED|registration-token-not-registered/i.test(detail)) {
      return { to: masked, status: "unregistered", detail: "token is no longer registered" };
    }
  } catch {
    /* non-JSON error body — keep the status-level detail */
  }
  return { to: masked, status: "error", detail };
}

/** Look up all registered tokens for a phone (digits-normalized). */
export async function tokensForPhone(phone: string): Promise<string[]> {
  const rows = (await sql()`
    select token from public.push_tokens
    where phone = ${phone.replace(/[^0-9]/g, "")}
    order by updated_at desc
    limit 20`) as unknown as Array<{ token: string }>;
  return rows.map((r) => r.token);
}

/** Which phone owns a token (for token-only sends). Empty when unknown. */
export async function phoneForToken(token: string): Promise<string> {
  const rows = (await sql()`
    select phone from public.push_tokens where token = ${token} limit 1
  `) as unknown as Array<{ phone: string }>;
  return rows[0]?.phone ?? "";
}

/* ── Business-hours rule (owner-directed 2026-09-06) ───────────────
 * HomeTeam notices + peer-support-facing pushes respect 8am–6pm Mon–Fri
 * local unless the recipient consents to after-hours. Self-test sends and
 * roster-admin sends (the two admins) are not subject to the hours gate —
 * pushed by explicit design. Callers (emergency-alert / peer-support /
 * group-notice routes) enforce this; the low-level send does NOT. */
export function inBusinessHours(now: Date = new Date()): boolean {
  const day = now.getDay();
  const hour = now.getHours();
  return day >= 1 && day <= 5 && hour >= 8 && hour < 18;
}

/* ── Shared send helper (server-gated) ─────────────────────────────
 * The gate: targetPhone must equal the caller's own phone, OR the caller
 * must be a roster admin. Token-only sends (owner test on a device whose
 * row exists) must be the token owner's own phone. Never auto-contacts. */
export interface GateCheck {
  allowed: boolean;
  reason?: string;
}
export async function gateSend(callerPhone: string, targetPhone: string, token?: string): Promise<GateCheck> {
  const caller = (callerPhone || "").replace(/[^0-9]/g, "");
  const target = (targetPhone || "").replace(/[^0-9]/g, "");
  if (!caller) return { allowed: false, reason: "caller phone required" };
  if (token) {
    const owner = await phoneForToken(token);
    if (owner === caller) return { allowed: true };
  }
  if (target && target === caller) return { allowed: true };
  const admin = await isRosterAdmin(caller);
  if (admin) return { allowed: true };
  return { allowed: false, reason: "You can only push to your own phone, or (as MPRCC admin) to roster recipients." };
}