/**
 * Peer-support queue (owner-directed 2026-09-06) — roster-admin phone-first view.
 *
 * Lists open + claimed requests via GET /api/peer-support/queue?phone=… with
 * claim / hand-off / mark-done via POST /api/peer-support/claim. The gate is
 * server-side (isRosterAdmin); here a 403 renders the calm line "This queue
 * is for the MPRCC outreach team." A 503/no_table means the DB update hasn't
 * landed yet — say so plainly, never an error wall.
 *
 * Jennings + Bambi = full admin per the plan; staff-limited (Tracey) is NOT
 * cleared for this queue — the server enforces that, this page just renders
 * the calm 403 line for anyone who isn't a roster admin.
 */
import { useCallback, useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "~/components/shell";
import { Button, Card, EmptyState, SkeletonRows, StatusBadge } from "~/components/ui";
import { formatPhone, getAlertIdentity, phoneLooksOk } from "~/lib/alertIdentity";
import { CheckCircleIcon, HandsIcon } from "~/lib/icons";
import { SubmitConfirm, type SubmitConfirmState } from "~/components/submitConfirm";

interface QueueRow {
  id: string;
  phone: string;
  name: string | null;
  note: string | null;
  status: string;
  claimedBy: string | null;
  delegateTo: string | null;
  outcomeNote: string | null;
  createdAt: string;
  updatedAt: string;
  isUrgent?: boolean;
  needCategory?: string | null;
  location?: string | null;
  fuzzLat?: number | null;
  fuzzLng?: number | null;
  hasExact?: boolean;
  expiresAt?: string | null;
}

const URGENT_LABEL: Record<string, string> = {
  help: "Help",
  advocacy: "Advocacy",
  er_ride: "ER ride",
  er_supplies: "ER supplies",
  support: "Support",
};

type LoadState =
  | { kind: "loading" }
  | { kind: "forbidden" }
  | { kind: "unavailable"; message: string }
  | { kind: "ready"; rows: QueueRow[] };

function timeLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function badgeFor(status: string): "Active" | "Planned" | "Resolved" {
  if (status === "claimed") return "Planned";
  if (status === "done" || status === "closed") return "Resolved";
  return "Active";
}

function RequestCard({
  row,
  callerPhone,
  acting,
  onAct,
}: {
  row: QueueRow;
  callerPhone: string;
  acting: boolean;
  onAct: (row: QueueRow, action: "claim" | "done", extra?: string) => void;
}) {
  const [handoff, setHandoff] = useState(false);
  const [teammate, setTeammate] = useState("");
  const [outcome, setOutcome] = useState("");
  const teammateOk = phoneLooksOk(teammate);

  return (
    <Card>
      {row.isUrgent ? (
        <p className="mb-2 inline-flex items-center gap-1.5 rounded-full bg-sg-clay px-2.5 py-1 text-small font-semibold text-white">
          <span aria-hidden>!</span> Urgent need{row.needCategory ? ` — ${URGENT_LABEL[row.needCategory] ?? row.needCategory}` : ""}
        </p>
      ) : null}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-h2">{row.name || "A neighbor"}</h2>
          <p className="mt-0.5 text-small text-sg-ink-soft">
            <a href={`tel:${row.phone}`} className="text-sg-sky underline underline-offset-2">
              {formatPhone(row.phone)}
            </a>
            {" · "}{timeLabel(row.createdAt)}
          </p>
        </div>
        <StatusBadge kind={badgeFor(row.status)}>
          {row.status === "open" ? "New" : row.status === "claimed" ? "Claimed" : "Done"}
        </StatusBadge>
      </div>

      {row.note ? (
        <p className="mt-2 break-words text-body text-sg-ink">{row.note}</p>
      ) : (
        <p className="mt-2 text-small text-sg-ink-soft">No note — just asked for a peer.</p>
      )}

      {row.isUrgent && (row.location || row.fuzzLat != null || row.hasExact) ? (
        <p className="mt-2 text-small text-sg-ink-soft">
          Location: {row.location === "exact" ? "exact spot (team only)" : row.location === "fuzzed" ? "approximate area" : "none"}
          {row.location === "fuzzed" && row.fuzzLat != null && row.fuzzLng != null
            ? ` — ${row.fuzzLat.toFixed(3)}, ${row.fuzzLng.toFixed(3)}`
            : ""}
          {row.hasExact ? " — exact on file, clears when done" : ""}
        </p>
      ) : null}

      {row.claimedBy ? (
        <p className="mt-2 text-small text-sg-ink-soft">
          {row.claimedBy === callerPhone ? "You're on this one." : `Claimed by ${formatPhone(row.claimedBy)}.`}
          {row.delegateTo ? ` Handed to ${formatPhone(row.delegateTo)}.` : ""}
        </p>
      ) : null}
      {row.status === "done" && row.outcomeNote ? (
        <p className="mt-2 text-small text-sg-ink-soft">Outcome: {row.outcomeNote}</p>
      ) : null}

      {row.status !== "done" && row.status !== "closed" ? (
        <div className="mt-3 flex flex-col gap-2">
          {row.status === "open" ? (
            <Button
              variant="secondary"
              full
              disabled={acting}
              onClick={() => onAct(row, "claim", handoff && teammateOk ? teammate : undefined)}
            >
              I&apos;m on it
            </Button>
          ) : null}
          {!handoff ? (
            <Button variant="quiet" full disabled={acting} onClick={() => setHandoff(true)}>
              Hand to a teammate…
            </Button>
          ) : (
            <div className="flex flex-col gap-2 rounded-[12px] border border-sg-line bg-sg-paper p-3">
              <label className="flex flex-col gap-1.5">
                <span className="text-btn font-medium">Teammate&apos;s phone</span>
                <input
                  value={teammate}
                  onChange={(e) => setTeammate(e.target.value)}
                  placeholder="e.g. 415 555-0142"
                  inputMode="tel"
                  className="min-h-[52px] w-full rounded-[12px] border-2 border-sg-line bg-sg-card px-4 text-body text-sg-ink outline-none focus:border-sg-ink"
                />
              </label>
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  full
                  disabled={acting || !teammateOk}
                  onClick={() => onAct(row, "claim", teammate)}
                >
                  Hand off
                </Button>
                <Button variant="quiet" full disabled={acting} onClick={() => { setHandoff(false); setTeammate(""); }}>
                  Never mind
                </Button>
              </div>
            </div>
          )}
          <label className="flex flex-col gap-1.5">
            <span className="text-btn font-medium">Outcome note (optional, for the report)</span>
            <input
              value={outcome}
              onChange={(e) => setOutcome(e.target.value)}
              placeholder="e.g. Called back, doing okay"
              maxLength={500}
              className="min-h-[52px] w-full rounded-[12px] border-2 border-sg-line bg-sg-card px-4 text-body text-sg-ink outline-none focus:border-sg-ink"
            />
          </label>
          <Button full disabled={acting} onClick={() => onAct(row, "done", outcome)}>
            Mark done
          </Button>
        </div>
      ) : null}
    </Card>
  );
}

function QueuePage() {
  const [identity] = useState(() => getAlertIdentity());
  const [phoneInput, setPhoneInput] = useState(identity?.phone ?? "");
  const [phone, setPhone] = useState(identity?.phone ?? "");
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [acting, setActing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [testNote, setTestNote] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  /** Persistent on-screen confirmation of queue actions (owner-directed 2026-09-07). */
  const [actionConfirmed, setActionConfirmed] = useState<SubmitConfirmState | null>(null);

  const sendTestToSelf = async () => {
    if (phone.length < 10 || testing) return;
    setTesting(true);
    setTestNote(null);
    try {
      const res = await fetch("/api/push/send", {
        method: "POST",
        headers: { "content-type": "application/json", "x-sg-phone": phone },
        body: JSON.stringify({
          phone,
          title: "SafeGround test",
          body: "It's you. This is a SafeGround test notification for this phone.",
        }),
      });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      setTestNote(
        res.ok && data?.ok
          ? "Sent — it should appear on this phone now."
          : (data?.error ?? "That didn't go through — check push is set up for this phone."),
      );
    } catch {
      setTestNote("No connection — nothing was sent.");
    } finally {
      setTesting(false);
    }
  };

  const load = useCallback(async (p: string) => {
    setState({ kind: "loading" });
    try {
      const res = await fetch(`/api/peer-support/queue?phone=${encodeURIComponent(p)}`);
      const data = (await res.json().catch(() => null)) as {
        ok?: boolean;
        error?: string;
        requests?: QueueRow[];
      } | null;
      if (res.status === 403) {
        setState({ kind: "forbidden" });
      } else if (res.ok && data?.ok) {
        setState({ kind: "ready", rows: data.requests ?? [] });
      } else {
        setState({
          kind: "unavailable",
          message: data?.error ?? "Couldn't load the queue — the database didn't answer.",
        });
      }
    } catch {
      setState({ kind: "unavailable", message: "No connection right now — the queue will be here when you're back." });
    }
  }, []);

  useEffect(() => {
    if (phone.length >= 10) void load(phone);
    else setState({ kind: "loading" });
  }, [phone, load]);

  const act = async (row: QueueRow, action: "claim" | "done", extra?: string) => {
    setActing(true);
    setActionError(null);
    try {
      const body: Record<string, string> =
        action === "claim" && extra && phoneLooksOk(extra)
          ? { phone, id: row.id, action: "delegate", delegateTo: extra }
          : action === "done"
            ? { phone, id: row.id, action: "done", outcomeNote: extra ?? "" }
            : { phone, id: row.id, action: "claim" };
      const res = await fetch("/api/peer-support/claim", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (res.ok && data?.ok) {
        // Persistent on-screen confirmation (owner-directed): the queue write
        // LANDED. The request's original push already notified the admins; the
        // claim/handoff/done itself is record-keeping, so "the queue is updated"
        // is the honest line — no overclaim of a second team push.
        const delegated = action === "claim" && !!extra && phoneLooksOk(extra);
        const verb = delegated ? "handed off" : action === "claim" ? "claimed" : "marked done";
        setActionConfirmed({
          saved: true,
          kind: "saved",
          line: `Saved — ${verb}. The queue now shows it.`,
        });
        await load(phone);
      } else {
        setActionConfirmed({ saved: false, kind: "draft", line: data?.error ?? "That didn't go through — nothing changed." });
        setActionError(data?.error ?? "That didn't go through — nothing changed.");
      }
    } catch {
      setActionError("No connection — nothing changed.");
    } finally {
      setActing(false);
    }
  };

  return (
    <AppShell>
      <div className="flex flex-col gap-4 px-4 pt-5">
        <header>
          <h1 className="text-h1">Peer-support queue</h1>
          <p className="mt-0.5 text-small text-sg-ink-soft">Neighbors who asked for a peer — urgent needs first, then newest.</p>
        </header>

        <Card>
          <label className="flex flex-col gap-1.5">
            <span className="text-btn font-medium">Your outreach phone</span>
            <div className="flex gap-2">
              <input
                value={phoneInput}
                onChange={(e) => setPhoneInput(e.target.value)}
                placeholder="e.g. 415 555-0142"
                inputMode="tel"
                className="min-h-[52px] w-full min-w-0 flex-1 rounded-[12px] border-2 border-sg-line bg-sg-card px-4 text-body text-sg-ink outline-none focus:border-sg-ink"
              />
              <Button
                variant="secondary"
                disabled={!phoneLooksOk(phoneInput)}
                onClick={() => setPhone(phoneInput.replace(/[^0-9]/g, ""))}
              >
                Open
              </Button>
            </div>
            <span className="text-small text-sg-ink-soft">Only roster admins (Jenn + Bambi) can open this queue.</span>
          </label>
        </Card>

        {actionError ? (
          <p className="rounded-[12px] bg-sg-clay-wash px-3 py-2 text-small text-sg-clay" role="alert">
            {actionError}
          </p>
        ) : null}

        {actionConfirmed ? (
          <div className="flex flex-col gap-2">
            <SubmitConfirm state={actionConfirmed} />
            <p className="text-small text-sg-ink-soft">
              {actionConfirmed.kind === "draft"
                ? "Nothing changed — you can try again when you're ready."
                : "The record is saved — the team sees the update on their next load."}
            </p>
          </div>
        ) : null}

        {phone.length < 10 ? (
          <EmptyState
            icon={<HandsIcon size={28} />}
            title="Whose queue is this?"
            body="Enter the outreach phone you use with the team, so we can check you're on the roster."
          />
        ) : state.kind === "loading" ? (
          <SkeletonRows rows={3} />
        ) : state.kind === "forbidden" ? (
          <EmptyState
            icon={<HandsIcon size={28} />}
            title="This queue is for the MPRCC outreach team."
            body="That number isn't on the outreach roster — if you're on the team, check the number and try again, no rush."
          />
        ) : state.kind === "unavailable" ? (
          <EmptyState
            icon={<HandsIcon size={28} />}
            title="The queue isn't up yet"
            body={state.message}
            steps={<Button variant="secondary" full onClick={() => void load(phone)}>Try again</Button>}
          />
        ) : (
          <div className="flex flex-col gap-3">
            {/* ready branch: loading/forbidden/unavailable handled above */}
            {phone.length >= 10 ? (
              <Card>
                <p className="text-body font-medium">Notifications for this phone</p>
                <p className="mt-0.5 text-small text-sg-ink-soft">
                  Sends a test notification to this phone only — never to anyone else.
                </p>
                <div className="mt-3">
                  <Button variant="secondary" full disabled={testing} onClick={() => void sendTestToSelf()}>
                    {testing ? "Sending…" : "Send a test notification to this phone"}
                  </Button>
                </div>
                {testNote ? <p className="mt-2 text-small text-sg-ink-soft">{testNote}</p> : null}
              </Card>
            ) : null}
            {state.rows.length === 0 ? (
              <EmptyState
                icon={<CheckCircleIcon size={28} />}
                title="All clear — no open requests"
                body="When a neighbor asks for peer support, it lands here first."
                steps={<Button variant="secondary" full onClick={() => void load(phone)}>Refresh</Button>}
              />
            ) : (
              <>
                {state.rows.map((row) => (
                  <RequestCard key={row.id} row={row} callerPhone={phone} acting={acting} onAct={(r, a, e) => void act(r, a, e)} />
                ))}
              </>
            )}
          </div>
        )}
      </div>
    </AppShell>
  );
}

export const Route = createFileRoute("/peer-support-queue")({ component: QueuePage });
