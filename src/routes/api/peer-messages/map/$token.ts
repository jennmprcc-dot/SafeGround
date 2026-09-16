/**
 * GET /api/peer-messages/map/[token] — 24h-expiring location view for a peer
 * text (spec §A9.3). The token is embedded in the SMS link a peer receives;
 * it resolves to ONE peer_messages row and honors loc_expires_at (24h).
 *
 * Returns the FUZZED point (~150m) for everyone except the sender themself:
 * when the caller's x-sg-phone belongs to the thread's sender, the exact
 * point is included (the split-point floor — exact coords are sender-only).
 * Never returns raw coords to a stranger: an unknown/expired token answers
 * { ok:false } with no existence leak.
 */
import { createFileRoute } from "@tanstack/react-router";
import { mapTokenView } from "~/lib/peerMessageServer";

async function mapLookup(c: { request: Request; params: Record<string, string> }): Promise<Response> {
  const token = String(c.params?.token ?? c.request.url.split("/").pop() ?? "").slice(0, 80);
  const callerPhone = String(c.request.headers.get("x-sg-phone") ?? "").replace(/[^0-9]/g, "");
  try {
    const v = await mapTokenView(token, callerPhone);
    if (!v.ok) {
      return Response.json({ ok: false, expired: false }, { status: 404 });
    }
    return Response.json(v);
  } catch {
    return Response.json({ ok: false, expired: false }, { status: 503 });
  }
}

export const Route = createFileRoute("/api/peer-messages/map/$token")({
  server: {
    handlers: {
      GET: mapLookup,
    },
  },
});