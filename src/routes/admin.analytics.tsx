/**
 * Admin analytics dashboard (owner-directed 2026-09-07) — /admin/analytics.
 *
 * Server-gated: on mount fetches GET /api/admin/analytics with the
 * x-sg-phone header (same caller-phone plumbing as the peer-support queue).
 * 403 (non-admin, incl. Tracey/staff_limited) → the calm line, never numbers,
 * never error text, never a broken chart. Charts are hand-rolled SVG +
 * Tailwind (no chart library) in the DESIGN_SYSTEM palette
 * (sage/ink/gold on paper/card).
 *
 * PRIVACY: everything rendered here is an aggregate counter. No phones,
 * names, locations, or personal data are ever collected or displayed.
 */
import { useCallback, useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "~/components/shell";
import { Button, Card, EmptyState, SkeletonRows } from "~/components/ui";
import { getAlertIdentity, phoneLooksOk } from "~/lib/alertIdentity";
import { HandsIcon } from "~/lib/icons";

interface MonthData {
  peerSupportMonth: number;
  checkInsMonth: number;
  activeUsersMonth: number;
  resourceSearchesMonth: number;
}
interface TopCategory {
  category: string;
  count: number;
}
interface WeekDay {
  day: string;
  requests: number;
  checkIns: number;
}
interface AnalyticsData {
  month: MonthData;
  topCategories: TopCategory[];
  weeklyActivity: WeekDay[];
  sweepAlertViews: number;
}

type LoadState =
  | { kind: "loading" }
  | { kind: "forbidden" }
  | { kind: "unavailable"; message: string }
  | { kind: "ready"; data: AnalyticsData };

const CALM_TITLE = "This space is for the outreach team.";
const PRIVACY_LINE = "Anonymous and aggregate — no phone numbers, locations, or personal data are ever collected.";

function shortDayLabel(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return iso.slice(5);
  return d.toLocaleDateString("en-US", { weekday: "short" });
}

function MetricCard({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <p className="text-h2 tabular-nums">{value.toLocaleString("en-US")}</p>
      <p className="mt-1 text-small leading-snug text-sg-ink-soft">{label}</p>
    </Card>
  );
}

/** "Most-requested services" — horizontal bars, width ∝ count. */
function ServiceBars({ items }: { items: TopCategory[] }) {
  const total = items.reduce((s, i) => s + i.count, 0);
  const max = items.reduce((s, i) => Math.max(s, i.count), 0);
  if (items.length === 0 || total === 0) {
    return <p className="text-small text-sg-ink-soft">Nothing searched yet this month — bars appear as neighbors use the resource guide.</p>;
  }
  return (
    <div className="flex flex-col gap-2.5" role="img" aria-label={`Most-requested services: ${items.map((i) => `${i.category} ${i.count}`).join(", ")}`}>
      {items.map((i) => {
        const pct = ((i.count / total) * 100).toFixed(0);
        return (
          <div key={i.category} className="flex flex-col gap-1">
            <div className="flex items-baseline justify-between gap-2 text-small">
              <span className="min-w-0 truncate font-medium text-sg-ink">{i.category}</span>
              <span className="shrink-0 tabular-nums text-sg-ink-soft">
                {i.count.toLocaleString("en-US")} · {pct}%
              </span>
            </div>
            <div className="h-3 overflow-hidden rounded-full bg-sg-line" aria-hidden>
              <div
                className="h-full rounded-full bg-sg-sage"
                style={{ width: `${max > 0 ? Math.max(4, Math.round((i.count / max) * 100)) : 0}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** "Weekly activity" — 7-day grouped bars, two series (sage = requests, gold = check-ins). */
function WeeklyBars({ days }: { days: WeekDay[] }) {
  const max = days.reduce((s, d) => Math.max(s, d.requests, d.checkIns), 0);
  if (days.length === 0) {
    return <p className="text-small text-sg-ink-soft">No activity in the last 7 days yet.</p>;
  }
  return (
    <div
      role="img"
      aria-label={`Weekly activity: ${days.map((d) => `${d.day}: ${d.requests} requests, ${d.checkIns} check-ins`).join("; ")}`}
    >
      <div className="flex h-36 items-end justify-between gap-2">
        {days.map((d) => (
          <div key={d.day} className="flex min-w-0 flex-1 flex-col items-center gap-1">
            <div className="flex h-28 w-full items-end justify-center gap-1" aria-hidden>
              <div
                className="w-3 rounded-t-full bg-sg-sage"
                style={{ height: `${max > 0 ? Math.max(3, Math.round((d.requests / max) * 100)) : 0}%` }}
                title={`${d.requests} requests`}
              />
              <div
                className="w-3 rounded-t-full bg-sg-gold"
                style={{ height: `${max > 0 ? Math.max(3, Math.round((d.checkIns / max) * 100)) : 0}%` }}
                title={`${d.checkIns} check-ins`}
              />
            </div>
            <span className="text-small text-sg-ink-soft">{shortDayLabel(d.day)}</span>
          </div>
        ))}
      </div>
      <div className="mt-2 flex items-center justify-center gap-4 text-small text-sg-ink-soft">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-sg-sage" aria-hidden /> Requests
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-sg-gold" aria-hidden /> Check-ins
        </span>
      </div>
    </div>
  );
}

function AnalyticsPage() {
  const [identity] = useState(() => getAlertIdentity());
  const [phoneInput, setPhoneInput] = useState(identity?.phone ?? "");
  const [phone, setPhone] = useState(identity?.phone ?? "");
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [exporting, setExporting] = useState(false);
  const [exportNote, setExportNote] = useState<string | null>(null);

  const load = useCallback(async (p: string) => {
    setState({ kind: "loading" });
    try {
      const res = await fetch("/api/admin/analytics", { headers: { "x-sg-phone": p } });
      const data = (await res.json().catch(() => null)) as {
        ok?: boolean;
        error?: string;
        data?: AnalyticsData;
      } | null;
      if (res.status === 403) {
        setState({ kind: "forbidden" });
      } else if (res.ok && data?.ok && data.data) {
        setState({ kind: "ready", data: data.data });
      } else {
        setState({
          kind: "unavailable",
          message: data?.error ?? "Analytics are unavailable right now.",
        });
      }
    } catch {
      setState({ kind: "unavailable", message: "No connection right now — the numbers will be here when you're back." });
    }
  }, []);

  useEffect(() => {
    if (phone.length >= 10) void load(phone);
    else setState({ kind: "loading" });
  }, [phone, load]);

  const exportCsv = async () => {
    if (exporting || phone.length < 10) return;
    setExporting(true);
    setExportNote(null);
    try {
      const now = new Date();
      const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
      const res = await fetch(`/api/admin/export-grant-report?month=${month}`, {
        headers: { "x-sg-phone": phone },
      });
      if (!res.ok) {
        setExportNote(res.status === 403 ? CALM_TITLE : "The report isn't available right now — try again in a bit.");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `safeground-impact-report-${month}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      setExportNote("Saved — check your downloads for the report.");
    } catch {
      setExportNote("No connection — the report will be here when you're back.");
    } finally {
      setExporting(false);
    }
  };

  return (
    <AppShell>
      <div className="flex flex-col gap-4 px-4 pt-5">
        <header>
          <h1 className="text-h1">Impact + insights</h1>
          <p className="mt-0.5 text-small text-sg-ink-soft">How neighbors are using SafeGround — this month at a glance.</p>
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
            <span className="text-small text-sg-ink-soft">Only roster admins (Jenn + Bambi) can open these numbers.</span>
          </label>
        </Card>

        {phone.length < 10 ? (
          <EmptyState
            icon={<HandsIcon size={28} />}
            title="Whose numbers are these?"
            body="Enter the outreach phone you use with the team, so we can check you're on the roster."
          />
        ) : state.kind === "loading" ? (
          <SkeletonRows rows={3} />
        ) : state.kind === "forbidden" ? (
          <EmptyState
            icon={<HandsIcon size={28} />}
            title={CALM_TITLE}
            body="Those numbers are just for the outreach team — nothing to worry about here."
          />
        ) : state.kind === "unavailable" ? (
          <EmptyState
            icon={<HandsIcon size={28} />}
            title="The numbers aren't up yet"
            body={state.message}
            steps={<Button variant="secondary" full onClick={() => void load(phone)}>Try again</Button>}
          />
        ) : (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <MetricCard label="Peer-support requests (this month)" value={state.data.month.peerSupportMonth} />
              <MetricCard label="Active monthly users" value={state.data.month.activeUsersMonth} />
              <MetricCard label="Resource searches (this month)" value={state.data.month.resourceSearchesMonth} />
              <MetricCard label="Sweep-alert views" value={state.data.sweepAlertViews} />
            </div>

            <Card>
              <h2 className="text-h2">Most-requested services</h2>
              <p className="mt-0.5 text-small text-sg-ink-soft">Top resource searches this month.</p>
              <div className="mt-3">
                <ServiceBars items={state.data.topCategories} />
              </div>
            </Card>

            <Card>
              <h2 className="text-h2">Weekly activity</h2>
              <p className="mt-0.5 text-small text-sg-ink-soft">Last 7 days — requests vs check-ins.</p>
              <div className="mt-3">
                <WeeklyBars days={state.data.weeklyActivity} />
              </div>
            </Card>

            <Card>
              <h2 className="text-h2">Monthly impact report</h2>
              <p className="mt-0.5 text-small text-sg-ink-soft">
                A grant-ready summary of this month — anonymous counts only, ready to attach to a proposal.
              </p>
              <div className="mt-3">
                <Button variant="secondary" full disabled={exporting} onClick={() => void exportCsv()}>
                  {exporting ? "Building the report…" : "Export Monthly Impact Report"}
                </Button>
              </div>
              {exportNote ? <p className="mt-2 text-small text-sg-ink-soft">{exportNote}</p> : null}
            </Card>

            <p className="pb-2 text-center text-small text-sg-ink-soft">{PRIVACY_LINE}</p>
          </div>
        )}
      </div>
    </AppShell>
  );
}

export const Route = createFileRoute("/admin/analytics")({ component: AnalyticsPage });
