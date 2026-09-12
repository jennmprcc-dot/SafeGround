/**
 * Resource check-ins — admin-only card for the outreach Team tab (PR-C,
 * owner-directed 2026-09-11: "I NEED TO BE ABLE TO VERIFY RESOURCES").
 *
 * Lists pending listing-change reports (neighbor-flagged) with two actions:
 * "Verified" (listing is correct → resources.verified_at stamped fresh) and
 * "Not an issue" (dismissed). Rendered ONLY inside the outreach dashboard's
 * admin-gated Team section (Tracey/staff_limited never see this component);
 * the API enforces the same admin gate server-side (staff_limited can VIEW
 * the queue but never act).
 *
 * The PIN travels in the x-sg-pin header (never a URL) — same convention as
 * the dashboard gate. On a stale/expired gate the parent resets to the lock
 * screen via onGateRejected.
 */
import { useCallback, useEffect, useState } from "react";
import { Button, Card, SkeletonRows } from "~/components/ui";
import { SubmitConfirm } from "~/components/submitConfirm";
import { useLanguage, type I18nKey } from "~/lib/i18n";

interface ReportItem {
  id: string;
  resourceId: string;
  resourceName: string;
  category: string;
  reason: string;
  note: string | null;
  reportedByPhone: string | null;
  reportedByTail: string | null;
  createdAt: string | null;
}

const REASON_KEY: Record<string, I18nKey> = {
  closed: "rv_reason_closed",
  wrong_info: "rv_reason_wrong_info",
  hours_changed: "rv_reason_hours",
  other: "rv_reason_other",
};

type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; items: ReportItem[] }
  | { kind: "error"; message: string };

function timeLabel(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function ResourceCheckins({
  phone,
  pin,
  onGateRejected,
}: {
  phone: string;
  pin: string;
  /** PIN session died (reset/cooldown elsewhere) — parent drops back to the gate. */
  onGateRejected?: (code: string) => void;
}) {
  const { t } = useLanguage();
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: "ok" | "error"; line: string } | null>(null);

  const load = useCallback(async () => {
    setState({ kind: "loading" });
    try {
      const res = await fetch(`/api/resources/reported-changes?phone=${encodeURIComponent(phone)}`, {
        headers: pin ? { "x-sg-pin": pin } : {},
      });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; items?: ReportItem[]; code?: string; error?: string } | null;
      if (res.ok && data?.ok) {
        setState({ kind: "ready", items: Array.isArray(data.items) ? data.items : [] });
      } else if (res.status === 403 && data?.code) {
        onGateRejected?.(data.code);
        setState({ kind: "error", message: data.error ?? "Your outreach session needs a fresh PIN — reopen the dashboard." });
      } else {
        setState({ kind: "error", message: data?.error ?? "Couldn't load the check-ins — try again in a moment." });
      }
    } catch {
      setState({ kind: "error", message: "No connection right now — the check-ins will be here when you're back." });
    }
  }, [phone, pin, onGateRejected]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Admin acts on a report: verified (stamp listing fresh) or dismissed. */
  const act = async (item: ReportItem, action: "verified" | "dismissed") => {
    setBusy(true);
    setFeedback(null);
    try {
      const res = await fetch("/api/resources/mark-verified", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ phone, pin, verificationId: item.id, action }),
      });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; code?: string; error?: string } | null;
      if (res.ok && data?.ok) {
        setFeedback({
          kind: "ok",
          line: action === "verified" ? t("rv_staff_saved_verified") : t("rv_staff_saved_dismissed"),
        });
        await load();
      } else if (res.status === 403 && data?.code) {
        onGateRejected?.(data.code);
        setFeedback({ kind: "error", line: data.error ?? t("rv_staff_failed") });
      } else {
        setFeedback({ kind: "error", line: data?.error ?? t("rv_staff_failed") });
      }
    } catch {
      setFeedback({ kind: "error", line: "No connection — nothing changed." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="flex flex-col gap-3" aria-label={t("rv_staff_title")}>
      <div className="flex flex-col gap-1">
        <h2 className="text-h2">{t("rv_staff_title")}</h2>
        <p className="text-small text-sg-ink-soft">{t("rv_staff_sub")}</p>
      </div>

      {feedback ? (
        <SubmitConfirm state={{ saved: feedback.kind === "ok", kind: feedback.kind === "ok" ? "saved" : "draft", line: feedback.line }} />
      ) : null}

      {state.kind === "loading" ? (
        <SkeletonRows rows={2} />
      ) : state.kind === "error" ? (
        <Card>
          <p className="text-small text-sg-ink-soft">{state.message}</p>
          <div className="mt-2">
            <Button variant="secondary" full onClick={() => void load()}>
              Try again
            </Button>
          </div>
        </Card>
      ) : state.items.length === 0 ? (
        <Card>
          <p className="text-body font-medium">{t("rv_staff_empty")}</p>
          <p className="mt-0.5 text-small text-sg-ink-soft">{t("rv_staff_empty_sub")}</p>
        </Card>
      ) : (
        state.items.map((item) => (
          <Card key={item.id}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-body font-medium">{item.resourceName}</p>
                <p className="mt-0.5 text-small text-sg-ink-soft">
                  {t(REASON_KEY[item.reason] ?? "rv_reason_other")}
                  {item.note ? ` — ${item.note}` : ""}
                </p>
                <p className="mt-0.5 text-small text-sg-ink-soft">
                  {t("rv_staff_reported")} {timeLabel(item.createdAt)}
                  {item.reportedByTail ? ` · ${item.reportedByTail}` : ""}
                </p>
              </div>
            </div>
            <div className="mt-3 flex gap-2">
              <Button variant="secondary" full disabled={busy} onClick={() => void act(item, "verified")}>
                {t("rv_staff_verified")}
              </Button>
              <Button variant="quiet" full disabled={busy} onClick={() => void act(item, "dismissed")}>
                {t("rv_staff_notissue")}
              </Button>
            </div>
          </Card>
        ))
      )}
    </section>
  );
}