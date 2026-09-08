/**
 * Alert identity — phone + name for the emergency-alert flow.
 * Senders may have no auth account (R-P6/R-P7), so identity is a phone number
 * normalized to digits (the schema's phone PKs all use the same normalization).
 * Stored locally on this device; shared-device safety: cleared on sign-out.
 */

const PHONE_KEY = "sg.alert.phone";
const NAME_KEY = "sg.alert.name";

/** Digits-only normalized phone (matches sg_norm_phone: strip +, spaces, dashes). */
export function normPhone(raw: unknown): string {
  return String(raw ?? "").replace(/[^0-9]/g, "");
}

export interface AlertIdentity {
  phone: string;
  name: string;
}

export function getAlertIdentity(): AlertIdentity | null {
  if (typeof localStorage === "undefined") return null;
  const phone = normPhone(localStorage.getItem(PHONE_KEY) ?? "");
  const name = (localStorage.getItem(NAME_KEY) ?? "").trim();
  if (phone.length < 10) return null;
  return { phone, name: name || "Neighbor" };
}

export function setAlertIdentity(phone: string, name: string): AlertIdentity {
  const p = normPhone(phone);
  const n = name.trim().slice(0, 40) || "Neighbor";
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(PHONE_KEY, p);
    localStorage.setItem(NAME_KEY, n);
  }
  return { phone: p, name: n };
}

export function clearAlertIdentity(): void {
  if (typeof localStorage === "undefined") return;
  localStorage.removeItem(PHONE_KEY);
  localStorage.removeItem(NAME_KEY);
}

/** Basic sanity check for a phone the user typed. Calm wording, no blame. */
export function phoneLooksOk(raw: string): boolean {
  const p = normPhone(raw);
  return p.length >= 10 && p.length <= 15;
}

/** Format a digits-only phone for display: (415) 555-0142 style. */
export function formatPhone(raw: string): string {
  const p = normPhone(raw);
  if (p.length === 11 && p.startsWith("1")) return `(${p.slice(1, 4)}) ${p.slice(4, 7)}-${p.slice(7)}`;
  if (p.length === 10) return `(${p.slice(0, 3)}) ${p.slice(3, 6)}-${p.slice(6)}`;
  return p;
}