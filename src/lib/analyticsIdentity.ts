/**
 * Anonymous analytics install id (owner-directed 2026-09-07).
 *
 * A random, opaque device id used ONLY to de-duplicate counts for the grant
 * report ("unduplicated interactions" = distinct install ids in a window).
 * It is minted with crypto.randomUUID (Math.random-hex fallback), stored in
 * localStorage under its own `sg.analytics.install` key, and cached in module
 * scope. It is NEVER derived from — and never linkable to — phone, alias,
 * FCM token, IP, fingerprint, or any other identity. Separate namespace on
 * purpose: this module never touches `sg.device`, `sg.alert.phone`, or any
 * existing identity key.
 */

/** localStorage key — analytics namespace only. Do not reuse elsewhere. */
export const ANALYTICS_INSTALL_KEY = "sg.analytics.install";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True when the value looks like a minted install id (uuid shape). */
export function isAnalyticsInstallId(raw: unknown): boolean {
  return typeof raw === "string" && UUID_RE.test(raw);
}

let cached: string | null | undefined;

function mint(): string {
  try {
    if (
      typeof crypto !== "undefined" &&
      typeof crypto.randomUUID === "function"
    ) {
      return crypto.randomUUID();
    }
  } catch {
    /* fall through to the Math.random fallback below */
  }
  // Fallback: 128 bits of Math.random hex, uuid-shaped. Still opaque, still
  // random — never derived from phone/alias/FCM/IP/fingerprint.
  const hex = () =>
    Math.floor(Math.random() * 0xffff)
      .toString(16)
      .padStart(4, "0");
  return `${hex()}${hex()}-${hex()}-4${hex().slice(1)}-${((parseInt(hex(), 16) & 0x3fff) | 0x8000).toString(16)}-${hex()}${hex()}${hex()}`;
}

/**
 * Lazily mint + persist the anonymous install id. Never throws; returns null
 * outside a browser (server-side analytics rows simply carry install_id NULL).
 */
export function getAnalyticsInstallId(): string | null {
  if (cached !== undefined) return cached;
  try {
    if (typeof localStorage === "undefined") {
      cached = null;
      return null;
    }
    let v = localStorage.getItem(ANALYTICS_INSTALL_KEY);
    if (!isAnalyticsInstallId(v)) {
      v = mint();
      try {
        localStorage.setItem(ANALYTICS_INSTALL_KEY, v);
      } catch {
        /* private mode — keep the in-memory value for this session */
      }
    }
    cached = v;
    return v;
  } catch {
    cached = null;
    return null;
  }
}

/** Rotate the id (future privacy affordance). Never throws. */
export function resetAnalyticsInstallId(): string | null {
  try {
    const v = mint();
    try {
      if (typeof localStorage !== "undefined") {
        localStorage.setItem(ANALYTICS_INSTALL_KEY, v);
      }
    } catch {
      /* ignore — memory value still applies */
    }
    cached = v;
    return v;
  } catch {
    return null;
  }
}
