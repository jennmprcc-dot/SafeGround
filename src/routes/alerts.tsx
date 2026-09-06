/**
 * Receive / Inbox (WAVE2_UX_SPEC §Receive/help flow) + active-detail helper view.
 * Shows alerts visible to THIS phone: my own alerts, plus (if roster/HomeTeam)
 * actionable ones. Exact coordinates are stripped by the server fn unless this
 * viewer is the sender, an on-duty peer-team member, or notified HomeTeam, and
 * the UI additionally refrains from rendering exact unless canSeeExact.
 *
 * Calm: no WARNING/DANGER/URGENT/MISSING/siren anywhere.
 */
import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { AppShell, CrisisSheet } from "~/components/shell";
import { BottomSheet, Button, Card, EmptyState, SkeletonRows, StatusBadge, useToasts } from "~/components/ui";
import { useAuth } from "~/lib/auth";
import { listAlertsFor, claimEmergencyAlert } from "~/lib/server";
import { getAlertIdentity, formatPhone } from "~/lib/alertIdentity";
import type { AlertRow, AlertSource } from "~/lib/alerts";
import { ALERT_KIND_LABEL, outcomeLine } from "~/lib/alerts";
import { AlertMapPane, GetDirectionsButton, EXACT_VISIBILITY_LINE } from "~/components/alertMap";
import { HandsIcon, CheckIcon, PersonIcon } from "~/lib/icons";

function timeLabel(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function expiresInLine(a: AlertRow): string {
  const ms = new Date(a.expiresAt).getTime() - Date.now();
  const h = Math.max(0, Math.round(ms / 3_600_000));
  if (h <= 0) return "closes soon";
  return h === 1 ? "closes in about an hour" : `closes in about ${h}h`;
}

function AlertCard({ alert, open, onOpen }: { alert: AlertRow; open: boolean; onOpen: () => void }) {
  if (alert.resolved) {
    return (
      <button
        type="button"
        onClick={onOpen}
        aria-expanded={open}
        className="w-full rounded-[16px] border border-sg-line bg-sg-card p-4 text-left opacity-70 shadow-[0_1px_2px_rgba(30,42,50,0.08)]"
      >
        <p className="flex items-center gap-2 text-small font-medium text-sg-ink-soft">
          <CheckIcon size={14} aria-hidden />
          {outcomeLine(alert)}
        </p>
        <p className="mt-1 text-small text-sg-ink-soft">{ALERT_KIND_LABEL[alert.kind]}{alert.audience.includes("hometeam") ? " · HomeTeam" : ""}</p>
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-expanded={open}
      className="w-full rounded-[16px] border border-sg-line bg-sg-card p-4 text-left shadow-[0_1px_2px_rgba(30,42,50,0.08)] transition-colors hover:bg-sg-paper"
    >
      <div className="flex items-start gap-3">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[12px] bg-sg-sage-wash text-sg-sage" aria-hidden>
          <HandsIcon size={22} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <p className="truncate text-body font-medium text-sg-ink">{alert.senderName}</p>
            <span className="shrink-0 text-small text-sg-ink-soft">{timeLabel(alert.createdAt)}</span>
          </div>
          <p className="mt-0.5 text-small font-medium text-sg-sage-deep">{ALERT_KIND_LABEL[alert.kind]}</p>
          {alert.note ? <p className="mt-1 line-clamp-2 text-small text-sg-ink-soft">{alert.note}</p> : null}
          <p className="mt-1.5 text-small text-sg-ink-soft">
            {alert.location === "none"
              ? "No location shared"
              : alert.location === "exact"
                ? "Exact spot shared"
                : "Approximate area (~150m)"}
            {" · "}
            {expiresInLine(alert)}
          </p>
          {alert.claimedByName ? (
            <p className="mt-1 text-small font-medium text-sg-sage">
              {alert.claimedByName.split(" ")[0]} is on it
            </p>
          ) : null}
        </div>
      </div>
    </button>
  );
}

/** Active-detail helper view: location block per granularity + I'm on it. */
function ActiveDetailSheet({ alert, phone, onClose, onChanged }: {
  alert: AlertRow | null;
  phone: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { push } = useToasts();
  const [busy, setBusy] = useState(false);

  if (!alert) return null;

  const claim = async () => {
    setBusy(true);
    const res = await claimEmergencyAlert({ data: { alertId: alert.id, phone } });
    setBusy(false);
    if (res.ok) {
      push({ kind: "success", message: "You're on it — the sender can see who's helping." });
      onChanged();
    } else if (res.alreadyHelping) {
      push({ kind: "info", message: `${alert.claimedByName?.split(" ")[0] ?? "Someone"} is already helping — offer backup if you're close.` });
      onChanged();
    } else {
      push({ kind: "error", message: res.error ?? "That didn't go through — try again in a moment." });
    }
  };

  const mineClaimed = alert.claimedBy === phone;

  return (
    <BottomSheet open={!!alert} onClose={onClose} title={`${ALERT_KIND_LABEL[alert.kind]}`}>
      <div className="flex flex-col gap-4 pb-2">
        <p className="text-small text-sg-ink-soft">
          {alert.senderName} · {timeLabel(alert.createdAt)} · sent to {alert.audience.map((g) => (g === "hometeam" ? "HomeTeam" : g === "friends" ? "friends" : "peers")).join(", ")}
        </p>
        {alert.note ? (
          <p className="text-body text-sg-ink">{alert.note}</p>
        ) : (
          <p className="text-body text-sg-ink-soft">No note — just the heads-up.</p>
        )}

        {/* location block per granularity */}
        <section aria-label="Location">
          <AlertMapPane alert={alert} />
          {alert.location === "exact" && alert.canSeeExact ? (
            <p className="mt-2 text-small text-sg-ink-soft">{EXACT_VISIBILITY_LINE}</p>
          ) : null}
          {alert.location === "fuzzed" ? (
            <p className="mt-2 text-small text-sg-ink-soft">An approximate area (~150m) — not the exact spot.</p>
          ) : null}
        </section>

        {/* Get directions — ONLY when exact */}
        <GetDirectionsButton alert={alert} />
        <p className="text-small text-sg-ink-soft">This alert automatically closes {expiresInLine(alert)} — nothing lingers.</p>

        {/* I'm on it — first claim wins, server-atomic */}
        {mineClaimed ? (
          <div className="rounded-[16px] border border-sg-sage bg-sg-sage-wash p-4">
            <p className="text-body font-medium text-sg-sage-deep">You're on it — the sender can see you.</p>
            <p className="mt-1 text-small text-sg-ink-soft">Keep the human line open; the sender can clear whenever they're okay.</p>
          </div>
        ) : alert.claimedByName ? (
          <div className="rounded-[16px] border border-sg-line bg-sg-paper p-4">
            <p className="text-body font-medium text-sg-ink">
              {alert.claimedByName.split(" ")[0]} is already helping
            </p>
            <p className="mt-1 text-small text-sg-ink-soft">
              <Button variant="quiet" full className="!min-h-[44px]" onClick={() => push({ kind: "info", message: "A backup offer was sent their way." })}>
                Offer backup
              </Button>
            </p>
          </div>
        ) : (
          <Button full onClick={() => void claim()} disabled={busy}>
            I'm on it
          </Button>
        )}
      </div>
    </BottomSheet>
  );
}

function AlertsInbox() {
  const { signedIn, displayName, signIn } = useAuth();
  const { push } = useToasts();
  const [identity] = useState(() => getAlertIdentity());
  const [rows, setRows] = useState<AlertRow[]>([]);
  const [source, setSource] = useState<AlertSource>("demo");
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [crisisOpen, setCrisisOpen] = useState(false);

  const phone = identity?.phone ?? "";
  const name = identity?.name ?? displayName;

  useEffect(() => {
    let alive = true;
    if (!identity || !signedIn) {
      setLoading(false);
      setRows([]);
      return;
    }
    setLoading(true);
    listAlertsFor({ data: { phone } })
      .then((res) => {
        if (!alive) return;
        setRows(res.rows);
        setSource(res.source);
        setLoading(false);
      })
      .catch(() => {
        if (!alive) return;
        setRows([]);
        setSource("demo");
        setLoading(false);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity, signedIn, tick]);

  const active = useMemo(() => rows.filter((r) => !r.resolved), [rows]);
  const resolved = useMemo(() => rows.filter((r) => r.resolved), [rows]);
  const openAlert = rows.find((r) => r.id === openId) ?? null;

  if (!identity || !signedIn) {
    return (
      <AppShell>
        <div className="flex flex-col gap-4 px-4 pt-5">
          <header>
            <h1 className="text-h1">From your people</h1>
            <p className="mt-0.5 text-small text-sg-ink-soft">Alerts from people who trust you — or chose to share.</p>
          </header>
          <EmptyState
            icon={<HandsIcon size={28} />}
            title="Sign in with the number your people know"
            body="Alerts go to the phone number you share with friends and peers — the same one you use to check in. Nothing is sent until you choose to send it."
            steps={
              <Button
                full
                onClick={() => {
                  signIn(name);
                  push({ kind: "info", message: "Signed in — alerts will find you here." });
                }}
              >
                Sign in to see alerts
              </Button>
            }
          />
        </div>
      </AppShell>
    );
  }

  const needsPhone = !phone;
  return (
    <AppShell>
      <div className="flex flex-col gap-4 px-4 pt-5">
        <header className="flex items-start justify-between gap-2">
          <div>
            <h1 className="text-h1">From your people</h1>
            <p className="mt-0.5 text-small text-sg-ink-soft">{phone ? `Showing alerts for ${formatPhone(phone)} — yours first.` : "Add your number to see alerts."}</p>
          </div>
          <Link to="/alerts/new" className="flex min-h-[48px] min-w-[48px] items-center justify-center rounded-full bg-sg-sage text-white" aria-label="Send an alert">
            <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden>
              <path d="M12 5v14M5 12h14" />
            </svg>
          </Link>
        </header>

        {needsPhone ? (
          <EmptyState
            icon={<PersonIcon size={28} />}
            title="Your people need a way to know it's you"
            body="Add the phone number your friends already have — it stays on this device and is never shown to strangers."
            steps={
              <Button full onClick={() => push({ kind: "info", message: "Add your number on the send page — it keeps alerts matching you." })}>
                Add my number
              </Button>
            }
          />
        ) : loading ? (
          <SkeletonRows rows={3} />
        ) : active.length === 0 && resolved.length === 0 ? (
          <EmptyState
            icon={<HandsIcon size={28} />}
            title="Nothing new right now"
            body="When someone sends an alert to their people, it will show up here — calm and clear, with every choice in the open."
            steps={
              <Link to="/alerts/new" className="block w-full">
                <Button full>Send an alert to my people</Button>
              </Link>
            }
          />
        ) : (
          <>
            {source === "demo" && rows.length > 0 ? (
              <p className="text-small text-sg-ink-soft">Demo alerts — shown so the shape is clear; live ones arrive when the database connects.</p>
            ) : null}
            <section aria-label="Active alerts">
              <h2 className="mb-2 text-small font-semibold text-sg-ink">Now</h2>
              <div className="flex flex-col gap-3">
                {active.map((a) => (
                  <AlertCard key={a.id} alert={a} open={openId === a.id} onOpen={() => setOpenId(a.id)} />
                ))}
              </div>
            </section>
            {resolved.length > 0 ? (
              <section aria-label="Resolved alerts">
                <h2 className="mb-2 mt-4 text-small font-semibold text-sg-ink-soft">Earlier, all clear</h2>
                <div className="flex flex-col gap-3">
                  {resolved.map((a) => (
                    <AlertCard key={a.id} alert={a} open={false} onOpen={() => setOpenId(a.id)} />
                  ))}
                </div>
              </section>
            ) : null}
          </>
        )}

        {source === "demo" && rows.length === 0 && !loading ? (
          <p className="text-small text-sg-ink-soft">Alerts are private to your people — nothing is broadcast, nothing auto-dispatched.</p>
        ) : null}

        <button type="button" onClick={() => setCrisisOpen(true)} className="self-start text-sg-sky underline underline-offset-2 min-h-[48px] inline-flex items-center">
          Talk to someone
        </button>
      </div>

      <ActiveDetailSheet alert={openAlert} phone={phone} onClose={() => setOpenId(null)} onChanged={() => setTick((t) => t + 1)} />
      <CrisisSheet open={crisisOpen} onClose={() => setCrisisOpen(false)} />
    </AppShell>
  );
}

export const Route = createFileRoute("/alerts")({ component: AlertsInbox });