/**
 * Sent-notice history (NOTICE-3, spec §2.2) — admin only.
 * Route: /outreach/directory/notices?phone=…
 *
 * Rows newest-first: title + audience · sent · after-hours · time · by first
 * name. Tap → detail sheet with full body + counts. Empty: "No notices sent
 * yet…". staff_limited + non-roster: route + RPC both reject with the calm
 * 404-equivalent.
 */
import { useCallback, useEffect, useState } from "react";
import { createFileRoute, useSearch } from "@tanstack/react-router";
import { AppShell } from "~/components/shell";
import { BottomSheet, Button, Card, EmptyState, SkeletonRows } from "~/components/ui";
import { getAlertIdentity, phoneLooksOk } from "~/lib/alertIdentity";
import { HandsIcon } from "~/lib/icons";

const CALM_404 = "This space is for the outreach team.";

interface Notice {
  id?: string;
  title?: string;
  body?: string;
  audience?: string;
  eligible?: number;
  sent?: number;
  skipped_after_hours?: number;
  skipped_no_token?: number;
  sent_by?: string;
  created_at?: string;
}

interface HistPayload {
  ok: boolean;
  notices?: Notice[];
  error?: string;
}

type LoadState =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "denied" }
  | { kind: "loading" }
  | { kind: "unavailable"; message: string }
  | { kind: "ready"; notices: Notice[] };

function audienceLabel(a: string | undefined): string {
  if (a === "hometeam") return "HomeTeam";
  if (a === "neighbors") return "Neighbors";
  if (a === "both") return "Both";
  return "Community";
}

function timeAgo(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const mins = Math.max(0, Math.round((Date.now() - d.getTime()) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h}h ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function NoticesPage() {
  const search = useSearch({ strict: false }) as { phone?: string };
  const [identity] = useState(() => getAlertIdentity());
  const [phoneInput, setPhoneInput] = useState(
    typeof search.phone === "string" && search.phone ? search.phone : (identity?.phone ?? ""),
  );
  const [phone, setPhone] = useState(
    typeof search.phone === "string" && search.phone ? search.phone.replace(/[^0-9]/g, "") : (identity?.phone ?? ""),
  );
  const [state, setState] = useState<LoadState>({ kind: "idle" });
  const [detail, setDetail] = useState<Notice | null>(null);

  const load = useCallback(async (p: string) => {
    setState({ kind: "loading" });
    try {
      const res = await fetch(`/api/directory/notices?phone=${encodeURIComponent(p)}`);
      const data = (await res.json().catch(() => null)) as HistPayload | null;
      if (res.status === 403) {
        setState({ kind: "denied" });
      } else if (res.ok && data?.ok) {
        setState({ kind: "ready", notices: data.notices ?? [] });
      } else {
        setState({
          kind: "unavailable",
          message: data?.error ?? "Couldn't load sent notices — the database didn't answer.",
        });
      }
    } catch {
      setState({ kind: "unavailable", message: "No connection right now — sent notices will be here when you're back." });
    }
  }, []);

  useEffect(() => {
    if (phone.length >= 10) void load(phone);
    else setState({ kind: "idle" });
  }, [phone, load]);

  return (
    <AppShell>
      <div className="flex flex-col gap-4 px-4 pt-5">
        <header>
          <h1 className="text-h1">Sent notices</h1>
          <p className="mt-0.5 text-small text-sg-ink-soft">What went out, to whom, and when — newest first.</p>
        </header>

        {phone.length < 10 ? (
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
            </label>
          </Card>
        ) : state.kind === "idle" || state.kind === "checking" || state.kind === "loading" ? (
          <SkeletonRows rows={3} />
        ) : state.kind === "denied" ? (
          <EmptyState
            icon={<HandsIcon size={28} />}
            title={CALM_404}
            body="If you're on the outreach team, check the number and try again, no rush."
          />
        ) : state.kind === "unavailable" ? (
          <EmptyState
            icon={<HandsIcon size={28} />}
            title="Sent notices aren't up yet"
            body={state.message}
            steps={<Button variant="secondary" full onClick={() => void load(phone)}>Try again</Button>}
          />
        ) : state.notices.length === 0 ? (
          <EmptyState
            icon={<HandsIcon size={28} />}
            title="No notices sent yet"
            body="When you send one, it'll be logged here."
          />
        ) : (
          <ul className="flex flex-col gap-2">
            {state.notices.map((n, i) => (
              <li key={n.id ?? i}>
                <button
                  type="button"
                  onClick={() => setDetail(n)}
                  className="w-full rounded-[16px] border border-sg-line bg-sg-card p-4 text-left shadow-[0_1px_2px_rgba(30,42,50,0.08)]"
                >
                  <p className="text-body font-medium">{n.title || "A notice"}</p>
                  <p className="mt-0.5 text-small text-sg-ink-soft">
                    {audienceLabel(n.audience)} · {n.sent ?? 0} sent · {n.skipped_after_hours ?? 0} after-hours · {timeAgo(n.created_at)}
                    {n.sent_by ? ` · by ${n.sent_by}` : ""}
                  </p>
                </button>
              </li>
            ))}
          </ul>
        )}

        <BottomSheet open={detail !== null} onClose={() => setDetail(null)} title={detail?.title || "Notice"}>
          {detail ? (
            <div className="flex flex-col gap-3">
              <p className="whitespace-pre-wrap break-words text-body">{detail.body}</p>
              <dl className="flex flex-col gap-2 text-small">
                <div className="flex gap-2">
                  <dt className="w-24 shrink-0 font-medium">Audience</dt>
                  <dd className="text-sg-ink-soft">{audienceLabel(detail.audience)}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="w-24 shrink-0 font-medium">Reached</dt>
                  <dd className="text-sg-ink-soft">
                    {detail.sent ?? 0} sent · {detail.skipped_after_hours ?? 0} after-hours · {detail.skipped_no_token ?? 0} without the app
                  </dd>
                </div>
                <div className="flex gap-2">
                  <dt className="w-24 shrink-0 font-medium">Sent</dt>
                  <dd className="text-sg-ink-soft">
                    {timeAgo(detail.created_at)}{detail.sent_by ? ` · by ${detail.sent_by}` : ""}
                  </dd>
                </div>
              </dl>
              <Button variant="quiet" full onClick={() => setDetail(null)}>
                Close
              </Button>
            </div>
          ) : null}
        </BottomSheet>
      </div>
    </AppShell>
  );
}

export const Route = createFileRoute("/outreach/directory/notices")({ component: NoticesPage });
