/**
 * Pass 3 — Volunteer flow staff queue (owner-directed 2026-09-12, Part B).
 * Rendered inside /outreach as the "Volunteers" tab, behind the page's
 * existing phone+PIN staff gate; the API re-checks the roster server-side
 * (volunteerGateOr403) so non-roster phones get the calm 403 line.
 *
 * New first, then contacted. Each row shows name-or-"Volunteer", interest
 * note, contact (PHONE/EMAIL — staff-only visibility), created_at, and a
 * Mark-contacted action. No auto-matching — staff reach out by phone/email.
 */
import { useCallback, useEffect, useState } from "react";
import { Button, Card, EmptyState, SkeletonRows, StatusBadge } from "~/components/ui";
import { CheckCircleIcon, HandsIcon } from "~/lib/icons";
import { useLanguage } from "~/lib/i18n";

interface VolunteerRow {
  id: string;
  name: string | null;
  contact: string;
  interestNote: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
}

type LoadState =
  | { kind: "loading" }
  | { kind: "forbidden" }
  | { kind: "unavailable"; message: string }
  | { kind: "ready"; rows: VolunteerRow[] };

function timeLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function VolunteerQueueSection({ phone }: { phone: string }) {
  const { t } = useLanguage();
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [actingId, setActingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    setState({ kind: "loading" });
    setActionError(null);
    try {
      const res = await fetch(`/api/volunteers?phone=${encodeURIComponent(phone)}`);
      const data = (await res.json().catch(() => null)) as { ok?: boolean; volunteers?: VolunteerRow[]; error?: string } | null;
      if (res.status === 403) {
        setState({ kind: "forbidden" });
      } else if (res.ok && data?.ok) {
        setState({ kind: "ready", rows: data.volunteers ?? [] });
      } else {
        setState({ kind: "unavailable", message: data?.error ?? t("vol_q_load_err") });
      }
    } catch {
      setState({ kind: "unavailable", message: t("vol_q_load_err") });
    }
  }, [phone, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const markContacted = async (id: string) => {
    setActingId(id);
    setActionError(null);
    setSaved(false);
    try {
      const res = await fetch("/api/volunteers/contacted", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, staffPhone: phone }),
      });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (res.ok && data?.ok) {
        setSaved(true);
        void load();
      } else {
        setActionError(data?.error ?? t("dn_q_err"));
      }
    } catch {
      setActionError(t("dn_q_err"));
    } finally {
      setActingId(null);
    }
  };

  if (state.kind === "loading") return <SkeletonRows rows={3} />;
  if (state.kind === "forbidden") {
    return (
      <EmptyState
        icon={<HandsIcon size={28} />}
        title={t("dn_q_403")}
        body={t("dn_q_403_sub")}
      />
    );
  }
  if (state.kind === "unavailable") {
    return (
      <EmptyState
        icon={<HandsIcon size={28} />}
        title={t("dn_q_unavailable")}
        body={state.message}
        steps={<Button variant="secondary" full onClick={() => void load()}>{t("sw_refresh")}</Button>}
      />
    );
  }
  const rows = state.rows;
  return (
    <section className="flex flex-col gap-3" aria-label={t("vol_q_title")}>
      <SectionTitle>{t("vol_q_title")}</SectionTitle>
      <p className="-mt-1 text-small text-sg-ink-soft">{t("vol_q_sub")}</p>
      {actionError ? (
        <p className="rounded-[12px] bg-sg-clay-wash px-3 py-2 text-small text-sg-clay" role="alert">
          {actionError}
        </p>
      ) : null}
      {saved ? (
        <p className="rounded-[12px] bg-sg-sage-wash px-3 py-2 text-small font-medium text-sg-sage-deep" role="status">
          {t("vol_q_saved")}
        </p>
      ) : null}
      {rows.length === 0 ? (
        <EmptyState
          icon={<CheckCircleIcon size={28} />}
          title={t("vol_q_empty")}
          body={t("vol_q_empty_sub")}
        />
      ) : (
        rows.map((r) => (
          <Card key={r.id}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-body font-medium">{r.name ?? "Volunteer"}</p>
                {r.interestNote ? (
                  <p className="mt-1 break-words text-small text-sg-ink-soft">{r.interestNote}</p>
                ) : null}
                <p className="mt-1 text-small text-sg-ink-soft">
                  {r.contact} · {timeLabel(r.createdAt)}
                </p>
              </div>
              <StatusBadge kind={r.status === "new" ? "Active" : "Verified"}>
                {r.status === "new" ? t("vol_q_title") : t("vol_q_marked")}
              </StatusBadge>
            </div>
            {r.status === "new" ? (
              <div className="mt-3">
                <Button
                  variant="secondary"
                  full
                  disabled={actingId === r.id}
                  onClick={() => void markContacted(r.id)}
                >
                  {t("vol_q_mark")}
                </Button>
              </div>
            ) : null}
          </Card>
        ))
      )}
    </section>
  );
}

/* Tiny local copy of outreach.tsx's internal SectionTitle (same styles) so
 * this component stays self-contained. */
function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="text-h2">{children}</h2>;
}