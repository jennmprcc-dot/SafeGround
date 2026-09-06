/**
 * /alerts/mine — the SENDER's active-alert view (WAVE2_UX_SPEC §Sender view).
 * Who's helping, "I'm OK — all clear" PRIMARY clear (records resolved_by_role
 * = sender + optional outcome note), quiet close-without-note secondary,
 * expires-at line. Calm copy only.
 */
import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell, CrisisSheet } from "~/components/shell";
import { Button, Card, EmptyState, Dialog, TextArea, useToasts } from "~/components/ui";
import { useAuth } from "~/lib/auth";
import { getMyActiveAlert, resolveEmergencyAlert } from "~/lib/server";
import { getAlertIdentity, formatPhone } from "~/lib/alertIdentity";
import type { AlertRow, AlertSource } from "~/lib/alerts";
import { ALERT_KIND_LABEL } from "~/lib/alerts";
import { AlertMapPane, GetDirectionsButton } from "~/components/alertMap";
import { CheckCircleIcon, HandsIcon, PersonIcon } from "~/lib/icons";

function timeLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function MineView() {
  const { signedIn, signIn } = useAuth();
  const { push } = useToasts();
  const [identity] = useState(() => getAlertIdentity());
  const [row, setRow] = useState<AlertRow | null>(null);
  const [source, setSource] = useState<AlertSource>("demo");
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const [clearOpen, setClearOpen] = useState(false);
  const [quietOpen, setQuietOpen] = useState(false);
  const [outcome, setOutcome] = useState("");
  const [saving, setSaving] = useState(false);
  const [crisisOpen, setCrisisOpen] = useState(false);

  const phone = identity?.phone ?? "";

  useEffect(() => {
    let alive = true;
    if (!identity || !signedIn) {
      setLoading(false);
      setRow(null);
      return;
    }
    setLoading(true);
    getMyActiveAlert({ data: { phone } })
      .then((res) => {
        if (!alive) return;
        setRow(res.row);
        setSource(res.source);
        setLoading(false);
      })
      .catch(() => {
        if (!alive) return;
        setRow(null);
        setSource("demo");
        setLoading(false);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity, signedIn, tick]);

  if (!signedIn || !identity) {
    return (
      <AppShell>
        <div className="flex flex-col gap-4 px-4 pt-5">
          <header>
            <h1 className="text-h1">Your alert</h1>
            <p className="mt-0.5 text-small text-sg-ink-soft">See who's helping and clear it when you're okay — no rush.</p>
          </header>
          <EmptyState
            icon={<HandsIcon size={28} />}
            title="Sign in to see your alert"
            body="Use the same number your people know, so this page can find what you sent."
            steps={<Button full onClick={() => signIn()}>Sign in</Button>}
          />
        </div>
      </AppShell>
    );
  }

  const clear = async (note: string) => {
    setSaving(true);
    const res = await resolveEmergencyAlert({ data: { alertId: row?.id ?? "", phone, note } });
    setSaving(false);
    if (res.ok) {
      push({ kind: "success", message: "All clear — your people can rest easy." });
      setRow(null);
      setOutcome("");
    } else {
      push({ kind: "error", message: res.error ?? "That didn't go through — nothing changed." });
    }
  };

  return (
    <AppShell>
      <div className="flex flex-col gap-4 px-4 pt-5">
        <header>
          <h1 className="text-h1">Your alert</h1>
          <p className="mt-0.5 text-small text-sg-ink-soft">Signed in as {identity.name} ({formatPhone(phone)}).</p>
        </header>

        {loading ? (
          <div className="rounded-[16px] border border-sg-line bg-sg-card p-4 text-small text-sg-ink-soft">Checking for an active alert…</div>
        ) : !row ? (
          <EmptyState
            icon={<CheckCircleIcon size={28} />}
            title="No active alert"
            body="When you send one from “Get help from my people,” it appears here — and clearing it is always in your hands."
            steps={
              <Link to="/alerts/new" className="block w-full">
                <Button full>Send an alert</Button>
              </Link>
            }
          />
        ) : (
          <>
            {source === "demo" ? <p className="text-small text-sg-ink-soft">Demo alert — shown so the shape is clear.</p> : null}
            <Card className="border-sg-sage/40">
              <div className="flex items-start gap-3">
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[12px] bg-sg-sage-wash text-sg-sage" aria-hidden>
                  <HandsIcon size={22} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-small font-medium text-sg-sage-deep">{ALERT_KIND_LABEL[row.kind]}</p>
                  {row.note ? <p className="mt-1 text-body text-sg-ink">{row.note}</p> : null}
                  <p className="mt-1.5 text-small text-sg-ink-soft">
                    Sent {timeLabel(row.createdAt)} · {row.location === "none" ? "no location" : row.location === "exact" ? "exact spot" : "approximate area"} ·
                    {row.expiresAt ? ` closes ${timeLabel(row.expiresAt)}` : ""}
                  </p>
                </div>
              </div>
            </Card>

            {/* Location block */}
            <section aria-label="Location">
              <AlertMapPane alert={row} />
            </section>
            <GetDirectionsButton alert={row} />

            {/* Who's helping */}
            <Card>
              <h2 className="text-h2">Who's helping</h2>
              <div className="mt-2 flex items-center gap-3">
                <span className="flex h-12 w-12 items-center justify-center rounded-[12px] bg-sg-sage-wash text-sg-sage" aria-hidden>
                  <PersonIcon size={20} />
                </span>
                <div>
                  {row.claimedByName ? (
                    <>
                      <p className="text-body font-medium text-sg-ink">{row.claimedByName}</p>
                      <p className="text-small text-sg-ink-soft">said “I'm on it”{row.claimedAt ? ` at ${timeLabel(row.claimedAt)}` : ""}</p>
                    </>
                  ) : (
                    <p className="text-body text-sg-ink-soft">Waiting for someone to say “I'm on it” — your people have this alert.</p>
                  )}
                </div>
              </div>
            </Card>

            {/* Clear — PRIMARY */}
            <Button full onClick={() => setClearOpen(true)}>
              I'm OK — all clear
            </Button>
            <Button variant="quiet" full onClick={() => setQuietOpen(true)}>
              Close without a note
            </Button>
            <p className="text-center text-small text-sg-ink-soft">
              Clears in their alerts when you say so — max 24h either way. Never calls 911.
            </p>
          </>
        )}

        <button type="button" onClick={() => setCrisisOpen(true)} className="self-start text-sg-sky underline underline-offset-2 min-h-[48px] inline-flex items-center">
          Talk to someone
        </button>
      </div>

      <Dialog
        open={clearOpen}
        title="Let your people know you're okay?"
        confirmLabel="I'm OK — all clear"
        onConfirm={() => { setClearOpen(false); void clear(outcome); }}
        onClose={() => setClearOpen(false)}
      >
        <p>This clears your alert for everyone who saw it. You can add a note so they know a little more.</p>
      </Dialog>

      <Dialog
        open={quietOpen}
        title="Close without a note?"
        confirmLabel="Close quietly"
        onConfirm={() => { setQuietOpen(false); void clear(""); }}
        onClose={() => setQuietOpen(false)}
      >
        <p>It's yours to close anytime — no explanation needed. Your people just see “all clear.”</p>
      </Dialog>

      {outcome.length > 0 && !quietOpen ? (
        <div className="px-4 pb-4">
          <TextArea
            label="A note for your people (optional)"
            maxLength={1000}
            value={outcome}
            onChange={(e) => setOutcome(e.target.value)}
            placeholder="Anything you'd like them to know?"
          />
        </div>
      ) : null}

      <CrisisSheet open={crisisOpen} onClose={() => setCrisisOpen(false)} />
    </AppShell>
  );
}

export const Route = createFileRoute("/alerts/mine")({ component: MineView });