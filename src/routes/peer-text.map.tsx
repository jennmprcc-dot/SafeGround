/**
 * /peer-text/map — the 24h-expiring location view a peer opens from a texted
 * link (spec §A9.3). Reads /api/peer-messages/map/[token] and renders the
 * fuzz (~150m circle) for peers; the sender themself (x-sg-phone matches)
 * sees the exact point. Expired/unknown tokens render a calm "expired" card —
 * nothing leaks (a stale link is just stale).
 */
import { useEffect, useState } from "react";
import { createFileRoute, useSearch } from "@tanstack/react-router";
import { AppShell } from "~/components/shell";
import { Card, Button } from "~/components/ui";
import { useLanguage } from "~/lib/i18n";
import { getAlertIdentity } from "~/lib/alertIdentity";

interface MapView {
  ok: boolean;
  expired: boolean;
  intent?: string;
  note?: string | null;
  senderName?: string;
  locKind?: "none" | "fuzzed" | "exact";
  fuzzLat?: number | null;
  fuzzLng?: number | null;
  exactLat?: number | null;
  exactLng?: number | null;
  callerIsSender?: boolean;
}

function FuzzCircle({ lat, lng }: { lat: number; lng: number }) {
  // Calm approximate-area graphic (the FriendsMap-style honest fake map): a
  // soft dot grid + a ~150m ring. Never a real map, never a pin — like the
  // check-in fuzz view.
  const dots: Array<{ top: number; left: number; o: number }> = [];
  for (let i = 0; i < 40; i += 1) dots.push({ top: (i * 37) % 78 + 8, left: (i * 53) % 78 + 8, o: 0.12 + ((i * 13) % 30) / 100 });
  return (
    <div className="relative mx-auto h-48 w-full overflow-hidden rounded-[16px] bg-sg-paper" aria-hidden>
      <div className="absolute inset-0" style={{ background: "radial-gradient(circle at 50% 45%, #dcefe5, #f7faf8 70%)" }}>
        {dots.map((d, i) => (
          <span key={i} className="absolute h-2 w-2 rounded-full bg-sg-sage-deep/25" style={{ top: `${d.top}%`, left: `${d.left}%`, opacity: d.o }} />
        ))}
      </div>
      <div className="absolute left-1/2 top-[45%] h-24 w-24 -translate-x-1/2 -translate-y-1/2 rounded-full border-4 border-dashed border-sg-sage-deep/50 bg-sg-sage/20" />
      <span className="absolute left-1/2 top-[45%] -translate-x-1/2 -translate-y-1/2 text-[10px] font-semibold tracking-wide text-sg-sage-deep">~150m</span>
      <span className="sr-only">Approximate area around the fuzzed coordinates {lat.toFixed(3)}, {lng.toFixed(3)}.</span>
    </div>
  );
}

function MapPageInner({ token }: { token: string }) {
  const { t } = useLanguage();
  const [state, setState] = useState<{ loading: boolean; view: MapView | null }>({ loading: true, view: null });
  useEffect(() => {
    let alive = true;
    const identity = getAlertIdentity();
    const phone = identity?.phone ?? "";
    fetch(`/api/peer-messages/map/${encodeURIComponent(token)}`, { headers: { "x-sg-phone": phone } })
      .then((r) => r.json().catch(() => null))
      .then((v) => {
        if (!alive) return;
        setState({ loading: false, view: (v as MapView) ?? null });
      })
      .catch(() => {
        if (!alive) return;
        setState({ loading: false, view: null });
      });
    return () => {
      alive = false;
    };
  }, [token]);

  const v = state.view;
  const expired = v?.ok === true && v.expired === true;

  return (
    <AppShell>
      <div className="flex flex-col gap-4 px-4 pt-5">
        <header>
          <h1 className="text-h1">📍 {expired ? t("ptext_map_expired") : v?.locKind === "exact" && v.callerIsSender ? t("ptext_map_exact") : t("ptext_map_fuzzed")}</h1>
          <p className="mt-0.5 text-small text-sg-ink-soft">
            {state.loading ? "Loading…" : expired ? t("ptext_map_expired") : "A location shared through SafeGround."}
          </p>
        </header>

        {state.loading ? (
          <Card><p className="text-body text-sg-ink-soft">Loading…</p></Card>
        ) : expired || !v?.ok ? (
          <Card>
            <p className="text-body text-sg-ink">{t("ptext_map_expired")}</p>
            <p className="mt-1 text-small text-sg-ink-soft">Links stop working 24 hours after they're sent — that's on purpose.</p>
          </Card>
        ) : (
          <Card className="flex flex-col gap-3">
            <p className="text-body font-medium text-sg-ink">
              {v.senderName ?? "A peer"}: {v.intent === "need" ? t("ptext_intent_need") : v.intent === "unsafe" ? t("ptext_intent_unsafe") : t("ptext_intent_ok")}
            </p>
            {v.note ? <p className="text-body text-sg-ink">“{v.note}”</p> : null}
            {v.locKind === "fuzzed" && v.fuzzLat != null && v.fuzzLng != null ? (
              <>
                <FuzzCircle lat={v.fuzzLat} lng={v.fuzzLng} />
                <p className="text-small text-sg-ink-soft">{t("ptext_loc_fuzzed_sub")}</p>
              </>
            ) : v.locKind === "exact" && v.exactLat != null && v.exactLng != null ? (
              <p className="text-small text-sg-ink-soft">{t("ptext_loc_exact_sub")}</p>
            ) : null}
            <Button
              full
              variant="secondary"
              onClick={() => {
                const lat = v.locKind === "exact" && v.exactLat != null ? v.exactLat : v.fuzzLat;
                const lng = v.locKind === "exact" && v.exactLng != null ? v.exactLng : v.fuzzLng;
                if (lat != null && lng != null) window.open(`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`, "_blank");
              }}
            >
              Get directions
            </Button>
          </Card>
        )}
      </div>
    </AppShell>
  );
}

function PeerTextMapPage() {
  const search = useSearch({ from: "/peer-text/map" }) as { token?: string };
  const token = String(search.token ?? "").slice(0, 80);
  if (!token) {
    return (
      <AppShell>
        <div className="px-4 pt-5">
          <Card><p className="text-body text-sg-ink-soft">This location link is missing its key.</p></Card>
        </div>
      </AppShell>
    );
  }
  return <MapPageInner token={token} />;
}

export const Route = createFileRoute("/peer-text/map")({
  validateSearch: (search: Record<string, unknown>) => ({
    token: typeof search?.token === "string" ? search.token : "",
  }),
  component: PeerTextMapPage,
});