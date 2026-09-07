/**
 * Shared directory-route glue (spec §2).
 *
 * One RPC call helper + the calm error tail: `select public.<fn>(…)` rows
 * come back as { v: jsonb }, and Postgres raises arrive prefixed — the UI
 * only ever shows the calm tail. Phone identity travels as the caller phone
 * (digits-normalized server-side); privilege comes only from the roster.
 */
import { query } from "~/db";
import {
  OUTREACH_CALM_LINE,
  normOutreachPhone,
  outreachIdentity,
} from "~/lib/outreachServer";

export { OUTREACH_CALM_LINE, normOutreachPhone, outreachIdentity };

export type RpcRow = { [k: string]: unknown };

export async function rpc(fn: string, args: unknown[]): Promise<unknown> {
  const q = `select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(",")}) as v`;
  const rows = (await query(q, args)) as unknown as Array<RpcRow>;
  return rows[0]?.v ?? null;
}

export const errOf = (e: unknown): string => {
  const m = String((e as { message?: string })?.message ?? "").trim();
  const tail = m.includes(": ") ? m.slice(m.lastIndexOf(": ") + 2) : m;
  return tail.slice(0, 220) || "That didn't go through — nothing changed.";
};

/** Caller phone from ?phone= or x-sg-phone header (digits-normalized). */
export function callerFrom(req: Request, body?: { phone?: unknown }): string {
  return normOutreachPhone(body?.phone ?? req.headers.get("x-sg-phone"));
}
