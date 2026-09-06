/**
 * Deterministic UUIDv5 in a SafeGround namespace — stable across runs.
 * Same shape/namespace as bootstrap.ts (kept separate to avoid the heavy
 * import graph of bootstrap → data → demo seed data).
 */
import { createHash } from "node:crypto";

const SG_NS = "a7e40a32-4f2e-5f6a-9d0e-6b1c2d3e4f50"; // safeground-seed namespace

export function uuid5(name: string): string {
  const h = createHash("sha1").update(SG_NS.replace(/-/g, ""), "hex").update(name).digest();
  const b = Uint8Array.from(h.subarray(0, 16));
  b[6] = (b[6] & 0x0f) | 0x50;
  b[8] = (b[8] & 0x3f) | 0x80;
  const hex = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
