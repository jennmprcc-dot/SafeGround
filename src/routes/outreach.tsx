/**
 * Outreach dashboard (Wave 2c, owner-directed 2026-09-06) — MPRCC staff only.
 *
 * Phone-first: enter the outreach phone used with the team; the server checks
 * the live roster and returns a per-role payload. Jenn + Bambi (admin) see
 * everything — sweeps verify/flag/resolve, open needs with claim/deliver,
 * active + resolved alerts with outcomes + analytics, the peer-support queue
 * link, and the push-notice stub. Tracey-style staff_limited sees ONLY
 * sweeps verify/flag + open needs + active alerts (kind + note, no contact
 * digits, no outcomes) — admin sections never render because the payload
 * never contains them. Non-roster → the calm 404-equivalent, no counts.
 *
 * Server-side role enforcement lives in /api/outreach/summary + /act (and
 * the resolve_emergency_alert RPC itself); this page only renders what the
 * payload carries — never client trust.
 */
import { useCallback, useEffect, useState } from "react";
import { createFileRoute, Link, useSearch } from "@tanstack/react-router";
import { AppShell } from "~/components/shell";
import { Button, Card, EmptyState, SkeletonRows, StatusBadge } from "~/components/ui";
import { StaffSmsTeam } from "~/components/staffSmsTeam";
import { getAlertIdentity, phoneLooksOk } from "~/lib/alertIdentity";
import { useLanguage } from "~/lib/i18n";
import { CheckCircleIcon, HandsIcon } from "~/lib/icons";
import { ALERT_KIND_LABEL } from "~/lib/alerts";
import { SubmitConfirm, type SubmitConfirmState } from "~/components/submitConfirm";

type Tab = "sweeps" | "needs" | "alerts" | "more";

interface SweepItem {
  id: string;
  status: string;
  severity: string;
  eventAt: string | null;
  note: string | null;
  lat: number;
  lng: number;
  createdAt: string | null;
}
interface NeedItem {
  id: string;
  items: string[];
  note: string | null;
  status: string;
  visibility: string;
  requesterLabel: string;
  claimedByName: string | null;
  assignedToName: string | null;
  createdAt: string | null;
}
interface AlertItem {
  id: string;
  kind: string;
  note: string | null;
  location: string;
  fuzzLat: number | null;
  fuzzLng: number | null;
  exactLat: number | null;
  exactLng: number | null;
  canSeeExact: boolean;
  senderName: string;
  senderPhone: string | null;
  senderTail: string | null;
  claimedByName: string | null;
  claimedAt: string | null;
  resolved: boolean;
  resolvedAt: string | null;
  resolvedByRole: string | null;
  outcomeNote: string | null;
  expiresAt: string | null;
  createdAt: string | null;
}
interface Summary {
  ok: boolean;
  role: "admin" | "staff_limited";
  name: string | null;
  push: { configured: boolean; note: string };
  counts: { sweepsToVerify: number; openNeeds: number; activeAlerts: number; peerOpen?: number };
  sweeps: SweepItem[];
  needs: NeedItem[];
  alerts: AlertItem[];
  resolved?: AlertItem[];
  analytics?: { resolved7d: number; medianResolveMinutes: number | null; withHelperShare: number | null };
  error?: string;
}

type LoadState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "forbidden" }
  | { kind: "unavailable"; message: string }
  | { kind: "ready"; data: Summary };

function timeLabel(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function SectionTitle({ children }: { children: string }) {
  return <h2 className="text-h2">{children}</h2>;
}

function OutreachPage() {
  const { t } = useLanguage();
  const [identity] = useState(() => getAlertIdentity());
  const [phoneInput, setPhoneInput] = useState(identity?.phone ?? "");
  const [phone, setPhone] = useState(identity?.phone ?? "");
  const [state, setState] = useState<LoadState>({ kind: "idle" });
  // 3-mode nav: /outreach?tab=alerts (Urgent Dispatch sub-tab) reuses the
  // existing tab state — default tab follows the query param when valid.
  const outreachSearch = useSearch({ from: "/outreach" }) as { tab?: string };
  const initialTab: Tab =
    outreachSearch.tab === "alerts" || outreachSearch.tab === "needs" || outreachSearch.tab === "sweeps" || outreachSearch.tab === "more"
      ? outreachSearch.tab
      : "sweeps";
  const [tab, setTab] = useState<Tab>(initialTab);
  const [acting, setActing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [clearFor, setClearFor] = useState<string | null>(null);
  const [outcome, setOutcome] = useState("");
  /** Persistent on-screen confirmation of dashboard actions (owner-directed 2026-09-07). */
  const [actionConfirmed, setActionConfirmed] = useState<SubmitConfirmState | null>(null);

  const load = useCallback(async (p: string) => {
    setState({ kind: "loading" });
    try {
      const res = await fetch(`/api/outreach/summary?phone=${encodeURIComponent(p)}`);
      const data = (await res.json().catch(() => null)) as (Summary & { error?: string }) | null;
      if (res.status === 403) {
        setState({ kind: "forbidden" });
      } else if (res.ok && data?.ok) {
        setState({ kind: "ready", data: data as Summary });
      } else {
        setState({
          kind: "unavailable",
          message: data?.error ?? "Couldn't load the dashboard — the database didn't answer.",
        });
      }
    } catch {
      setState({ kind: "unavailable", message: "No connection right now — the dashboard will be here when you're back." });
    }
  }, []);

  useEffect(() => {
    if (phone.length >= 10) void load(phone);
    else setState({ kind: "idle" });
  }, [phone, load]);

  const act = async (kind: "sweep" | "need" | "alert", id: string, action: string, note?: string) => {
    setActing(true);
    setActionError(null);
    try {
      const res = await fetch("/api/outreach/act", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ phone, kind, id, action, note: note ?? "" }),
      });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (res.ok && data?.ok) {
        // Persistent on-screen confirmation (owner-directed): the action LANDED.
        // Dashboard writes are record-keeping; there's no live push to a second
        // team beyond what the alert itself already did — "the team has it" is
        // honest without overclaiming a push.
        setActionConfirmed({
          saved: true,
          kind: "saved",
          line:
            kind === "alert" && action === "clear"
              ? "Saved — alert cleared as staff, outcome recorded."
              : kind === "need" && action === "claim"
                ? "Saved — claimed. The record shows you on it."
                : kind === "need" && action === "deliver"
                  ? "Saved — marked delivered."
                  : "Saved — the dashboard is updated.",
        });
        setClearFor(null);
        setOutcome("");
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

  const data = state.kind === "ready" ? state.data : null;
  const admin = data?.role === "admin";
  const firstName = data?.name ? data.name.split(" ")[0] : null;

  return (
    <AppShell>
      <div className="flex flex-col gap-4 px-4 pt-5">
        <header className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-h1">Outreach dashboard</h1>
            <p className="mt-0.5 text-small text-sg-ink-soft">
              The team queue — sweeps, needs, and alerts in one place.
            </p>
          </div>
          {data ? (
            <span
              className={
                admin
                  ? "inline-flex shrink-0 items-center rounded-full bg-sg-ink px-2.5 py-1 text-badge uppercase tracking-[0.04em] text-sg-card"
                  : "inline-flex shrink-0 items-center rounded-full bg-sg-sage-wash px-2.5 py-1 text-badge uppercase tracking-[0.04em] text-sg-sage"
              }
            >
              {admin ? `Admin${firstName ? ` · ${firstName}` : ""}` : `Staff${firstName ? ` · ${firstName}` : ""}`}
            </span>
          ) : null}
        </header>

        {/* 3-mode nav (§8): role-appropriate lines on the Admin side. Public /
            signed-out sees the calm locked line; staff_limited sees the team
            line. Chrome only — the payload + server gates decide the data. */}
        {data ? (
          admin ? null : (
            <p className="rounded-[12px] bg-sg-paper px-3 py-2 text-small text-sg-ink-soft">
              {t("mode_staff_limited")}
            </p>
          )
        ) : (
          <p className="rounded-[12px] bg-sg-paper px-3 py-2 text-small text-sg-ink-soft">
            {t("mode_admin_locked")}
          </p>
        )}

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
            <span className="text-small text-sg-ink-soft">Only numbers on the outreach roster can open this space.</span>
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
            title="Whose dashboard is this?"
            body="Enter the outreach phone you use with the team, so we can check you're on the roster."
          />
        ) : state.kind === "loading" || state.kind === "idle" ? (
          <SkeletonRows rows={3} />
        ) : state.kind === "forbidden" ? (
          <EmptyState
            icon={<HandsIcon size={28} />}
            title="This space is for the outreach team."
            body="That number isn't on the outreach roster — if you're on the team, check the number and try again, no rush."
          />
        ) : state.kind === "unavailable" ? (
          <EmptyState
            icon={<HandsIcon size={28} />}
            title="The dashboard isn't up yet"
            body={state.message}
            steps={<Button variant="secondary" full onClick={() => void load(phone)}>Try again</Button>}
          />
        ) : data ? (
          <>
            <div className="grid grid-cols-3 gap-2" role="status" aria-label="Queue counts">
              <Card className="p-3 text-center">
                <p className="text-h1">{data.counts.sweepsToVerify}</p>
                <p className="text-small text-sg-ink-soft">Sweeps to verify</p>
              </Card>
              <Card className="p-3 text-center">
                <p className="text-h1">{data.counts.openNeeds}</p>
                <p className="text-small text-sg-ink-soft">Open needs</p>
              </Card>
              <Card className="p-3 text-center">
                <p className="text-h1">{data.counts.activeAlerts}</p>
                <p className="text-small text-sg-ink-soft">Active alerts</p>
              </Card>
            </div>

            <nav className="flex gap-2 overflow-x-auto" aria-label="Dashboard sections">
              {(["sweeps", "needs", "alerts", "more"] as Tab[]).map((t) => (
                <button
                  key={t}
                  type="button"
                  aria-pressed={tab === t}
                  onClick={() => setTab(t)}
                  className={
                    tab === t
                      ? "min-h-[48px] flex-1 rounded-[12px] border-2 border-sg-sage bg-sg-sage-wash px-3 text-btn font-medium text-sg-sage-deep"
                      : "min-h-[48px] flex-1 rounded-[12px] border-2 border-sg-line bg-sg-card px-3 text-btn text-sg-ink"
                  }
                >
                  {t === "sweeps" ? "Sweeps" : t === "needs" ? "Needs" : t === "alerts" ? "Alerts" : admin ? "Team" : "Chat"}
                </button>
              ))}
            </nav>

            {tab === "sweeps" ? (
              <section className="flex flex-col gap-3" aria-label="Sweeps to verify">
                <SectionTitle>Sweeps to verify</SectionTitle>
                {data.sweeps.length === 0 ? (
                  <EmptyState
                    icon={<CheckCircleIcon size={28} />}
                    title="Nothing waiting"
                    body="Reported sweeps land here for a verify or a flag."
                  />
                ) : (
                  data.sweeps.map((s) => (
                    <Card key={s.id}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-body font-medium">
                            {s.severity === "active" ? "Happening now" : s.severity === "planned" ? "Planned" : s.severity}
                            {" · "}{timeLabel(s.eventAt) || timeLabel(s.createdAt)}
                          </p>
                          {s.note ? <p className="mt-1 break-words text-small text-sg-ink-soft">{s.note}</p> : null}
                        </div>
                        <StatusBadge kind={s.status === "verified" ? "Verified" : s.status === "flagged" ? "Reported" : "Active"}>
                          {s.status}
                        </StatusBadge>
                      </div>
                      {(s.status === "reported" || s.status === "flagged") ? (
                        <div className="mt-3 flex gap-2">
                          <Button variant="secondary" full disabled={acting} onClick={() => void act("sweep", s.id, "verify")}>
                            Verify
                          </Button>
                          <Button variant="quiet" full disabled={acting} onClick={() => void act("sweep", s.id, "flag")}>
                            Flag
                          </Button>
                          {admin ? (
                            <Button variant="quiet" full disabled={acting} onClick={() => void act("sweep", s.id, "resolve")}>
                              Resolve
                            </Button>
                          ) : null}
                        </div>
                      ) : admin && s.status === "verified" ? (
                        <div className="mt-3">
                          <Button variant="quiet" full disabled={acting} onClick={() => void act("sweep", s.id, "resolve")}>
                            Resolve
                          </Button>
                        </div>
                      ) : null}
                    </Card>
                  ))
                )}
              </section>
            ) : null}

            {tab === "needs" ? (
              <section className="flex flex-col gap-3" aria-label="Open needs">
                <SectionTitle>Open needs</SectionTitle>
                {data.needs.length === 0 ? (
                  <EmptyState
                    icon={<CheckCircleIcon size={28} />}
                    title="Nothing waiting"
                    body="Open supply needs land here — claim one to get it moving."
                  />
                ) : (
                  data.needs.map((n) => (
                    <Card key={n.id}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-body font-medium">
                            {(n.items ?? []).join(", ") || "A need"}
                          </p>
                          <p className="mt-0.5 text-small text-sg-ink-soft">
                            {n.requesterLabel}{n.visibility === "assign_only" ? " · Coordinator assigned" : ""}
                            {" · "}{timeLabel(n.createdAt)}
                          </p>
                          {n.note ? <p className="mt-1 break-words text-small text-sg-ink-soft">{n.note}</p> : null}
                          {n.claimedByName ? <p className="mt-1 text-small text-sg-ink-soft">Claimed by {n.claimedByName}.</p> : null}
                          {n.assignedToName ? <p className="mt-1 text-small text-sg-ink-soft">Assigned to {n.assignedToName}.</p> : null}
                        </div>
                        <StatusBadge kind={n.status === "open" ? "Active" : n.status === "delivered" ? "Resolved" : "Planned"}>
                          {n.status === "in_progress" ? "On the way" : n.status}
                        </StatusBadge>
                      </div>
                      {n.status === "open" ? (
                        <div className="mt-3">
                          <Button variant="secondary" full disabled={acting} onClick={() => void act("need", n.id, "claim")}>
                            Claim — I&apos;ll coordinate this
                          </Button>
                        </div>
                      ) : n.status === "claimed" || n.status === "in_progress" ? (
                        <div className="mt-3">
                          <Button full disabled={acting} onClick={() => void act("need", n.id, "deliver")}>
                            Mark delivered
                          </Button>
                        </div>
                      ) : null}
                    </Card>
                  ))
                )}
              </section>
            ) : null}

            {tab === "alerts" ? (
              <section className="flex flex-col gap-3" aria-label="Active alerts">
                <SectionTitle>Active alerts</SectionTitle>
                {data.alerts.length === 0 ? (
                  <EmptyState
                    icon={<CheckCircleIcon size={28} />}
                    title="No active alerts"
                    body="When a neighbor sends an alert to their people, the outreach team sees it here."
                  />
                ) : (
                  data.alerts.map((a) => (
                    <Card key={a.id}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-body font-medium">
                            {ALERT_KIND_LABEL[a.kind as keyof typeof ALERT_KIND_LABEL] ?? a.kind}
                            {" · "}{a.senderName}{a.senderTail ? ` ${a.senderTail}` : ""}
                          </p>
                          {a.note ? <p className="mt-1 break-words text-small text-sg-ink-soft">{a.note}</p> : null}
                          <p className="mt-1 text-small text-sg-ink-soft">
                            {a.location === "exact"
                              ? admin
                                ? "Exact spot shared — visible to you as admin."
                                : "Location shared privately with responders."
                              : a.location === "fuzzed"
                                ? "Approximate area shared (~150m)."
                                : "No location shared — words only."}
                            {a.claimedByName ? ` ${a.claimedByName} is helping.` : ""}
                            {" · "}{timeLabel(a.createdAt)}
                          </p>
                        </div>
                        <StatusBadge kind="Active">Active</StatusBadge>
                      </div>
                      {admin && a.senderPhone ? (
                        <p className="mt-2 text-small">
                          <a href={`tel:${a.senderPhone}`} className="text-sg-sky underline underline-offset-2">
                            Call {a.senderName}
                          </a>
                        </p>
                      ) : null}
                      {admin ? (
                        clearFor === a.id ? (
                          <div className="mt-3 flex flex-col gap-2 rounded-[12px] border border-sg-line bg-sg-paper p-3">
                            <label className="flex flex-col gap-1.5">
                              <span className="text-btn font-medium">Outcome note (for the record)</span>
                              <input
                                value={outcome}
                                onChange={(e) => setOutcome(e.target.value)}
                                placeholder="e.g. Met at the library, doing okay"
                                maxLength={1000}
                                className="min-h-[52px] w-full rounded-[12px] border-2 border-sg-line bg-sg-card px-4 text-body text-sg-ink outline-none focus:border-sg-ink"
                              />
                            </label>
                            <div className="flex gap-2">
                              <Button
                                variant="secondary"
                                full
                                disabled={acting || !outcome.trim()}
                                disabledReason={!outcome.trim() ? "An outcome note keeps the record honest." : undefined}
                                onClick={() => void act("alert", a.id, "clear", outcome)}
                              >
                                Clear alert
                              </Button>
                              <Button variant="quiet" full disabled={acting} onClick={() => { setClearFor(null); setOutcome(""); }}>
                                Never mind
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <div className="mt-3">
                            <Button variant="quiet" full disabled={acting} onClick={() => setClearFor(a.id)}>
                              Clear as staff (with outcome note)…
                            </Button>
                          </div>
                        )
                      ) : null}
                    </Card>
                  ))
                )}
                {admin && data.resolved && data.resolved.length > 0 ? (
                  <div className="mt-2 flex flex-col gap-3">
                    <SectionTitle>Resolved — outcomes</SectionTitle>
                    {data.resolved.map((a) => (
                      <Card key={a.id} className="opacity-90">
                        <p className="text-body font-medium">
                          {ALERT_KIND_LABEL[a.kind as keyof typeof ALERT_KIND_LABEL] ?? a.kind}
                          {" · "}{a.senderName}
                        </p>
                        <p className="mt-1 text-small text-sg-ink-soft">
                          {a.claimedByName ? `${a.claimedByName} helped · ` : ""}
                          {a.resolvedAt ? timeLabel(a.resolvedAt) : "Resolved"}
                          {a.resolvedByRole ? ` · by ${a.resolvedByRole}` : ""}
                        </p>
                        {a.outcomeNote ? <p className="mt-1 text-small text-sg-ink">Outcome: {a.outcomeNote}</p> : null}
                      </Card>
                    ))}
                  </div>
                ) : null}
                {admin && data.analytics ? (
                  <Card>
                    <SectionTitle>This week</SectionTitle>
                    <p className="mt-1 text-small text-sg-ink-soft">
                      {data.analytics.resolved7d} resolved
                      {data.analytics.medianResolveMinutes != null ? ` · median ${data.analytics.medianResolveMinutes}m to resolve` : ""}
                      {data.analytics.withHelperShare != null ? ` · ${Math.round(data.analytics.withHelperShare * 100)}% with a helper` : ""}
                    </p>
                  </Card>
                ) : null}
              </section>
            ) : null}

            {tab === "more" ? (
              admin ? (
                <section className="flex flex-col gap-3" aria-label="Team">
                  <SectionTitle>Team</SectionTitle>
                  <Card>
                    <p className="text-body font-medium">Peer-support queue</p>
                    <p className="mt-0.5 text-small text-sg-ink-soft">
                      {data.counts.peerOpen != null && data.counts.peerOpen > 0
                        ? `${data.counts.peerOpen} waiting for a peer.`
                        : "Neighbors who asked for a peer — claim and hand off."}
                    </p>
                    <div className="mt-3">
                      <a href={`/peer-support-queue?phone=${encodeURIComponent(phone)}`}>
                        <Button variant="secondary" full>Open peer-support queue</Button>
                      </a>
                    </div>
                  </Card>
                  <Card>
                    <p className="text-body font-medium">Reporting &amp; impact</p>
                    <p className="mt-0.5 text-small text-sg-ink-soft">
                      Anonymous, aggregate numbers for grants and outreach — open to any roster admin (Jenn + Bambi).
                    </p>
                    <div className="mt-3">
                      <a href={`/admin/analytics?phone=${encodeURIComponent(phone)}`}>
                        <Button variant="secondary" full>Open reporting &amp; impact</Button>
                      </a>
                    </div>
                  </Card>
                  <Card>
                    <p className="text-body font-medium">Group notices</p>
                    <p className="mt-0.5 text-small text-sg-ink-soft">{data.push.note}</p>
                    <div className="mt-3 flex flex-col gap-2">
                      <Link to="/outreach/directory" search={{ phone }} className="block w-full">
                        <Button variant="secondary" full>Open community directory</Button>
                      </Link>
                      <Link to="/outreach/directory/notice" search={{ phone }} className="block w-full">
                        <Button variant="quiet" full>Send a group notice</Button>
                      </Link>
                    </div>
                  </Card>
                  {/* SMS dispatch team (owner-directed 2026-09-10) — admins only,
                      same gate as the rest of this section; the API enforces it
                      server-side too (staff_limited → 403). */}
                  <StaffSmsTeam phone={phone} />
                </section>
              ) : (
                <section className="flex flex-col gap-3" aria-label="Chat">
                  <SectionTitle>Team chat</SectionTitle>
                  <EmptyState
                    title="Team chat isn't here yet"
                    body="When peer chat ships, this is where the team keeps in touch. For now, the queue above is the place to help."
                  />
                </section>
              )
            ) : null}
          </>
        ) : null}
      </div>
    </AppShell>
  );
}

export const Route = createFileRoute("/outreach")({
  validateSearch: (search: Record<string, unknown>) => ({
    tab: typeof search?.tab === "string" ? search.tab : undefined,
  }),
  component: OutreachPage,
});
