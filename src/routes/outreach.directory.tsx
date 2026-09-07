/**
 * Community directory (DIR-1 + DIR-2, spec §2.2) — MPRCC outreach team only.
 * Route: /outreach/directory (NOT nested — TanStack Start has no parent
 * layout route for /outreach, so this is a top-level page).
 *
 * Phone-first: enter the outreach phone used with the team; the server checks
 * the live roster and returns role-split rows. Jenn + Bambi (admin) see full
 * rows (phone, kind, opt-in status, after-hours flag) with tap-through member
 * detail + pause/resume + the Send-a-group-notice entry. Tracey-style
 * staff_limited sees names + kind + active ONLY — the REDACTED payload never
 * contains phones (server-side, never client filtering), rows are not
 * tappable, and there is no Send button, no history tab, no detail.
 * Non-roster → the calm 404-equivalent, no counts.
 */
import { useCallback, useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell } from "~/components/shell";
import { BottomSheet, Button, Card, EmptyState, SearchField, SkeletonRows } from "~/components/ui";
import { formatPhone, getAlertIdentity, phoneLooksOk } from "~/lib/alertIdentity";
import { CheckCircleIcon, HandsIcon } from "~/lib/icons";

interface Member {
  display_name?: string;
  kind?: string;
  active?: boolean;
  phone?: string;
  opted_in?: boolean;
  opted_in_at?: string | null;
  consents_to_after_hours?: boolean;
  last_active?: string | null;
}

interface DirPayload {
  ok: boolean;
  role?: "admin" | "staff_limited";
  name?: string | null;
  members?: Member[];
  error?: string;
}

type LoadState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "forbidden" }
  | { kind: "unavailable"; message: string }
  | { kind: "ready"; data: DirPayload };

type Filter = "all" | "hometeam" | "neighbor" | "staff";

function kindLabel(kind: string | undefined): string {
  if (kind === "hometeam") return "HomeTeam";
  if (kind === "neighbor") return "Neighbor";
  if (kind === "staff") return "Outreach";
  return "Community";
}

function dateLabel(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function DirectoryPage() {
  const [identity] = useState(() => getAlertIdentity());
  const [phoneInput, setPhoneInput] = useState(identity?.phone ?? "");
  const [phone, setPhone] = useState(identity?.phone ?? "");
  const [state, setState] = useState<LoadState>({ kind: "idle" });
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [detail, setDetail] = useState<Member | null>(null);
  const [acting, setActing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [howJoin, setHowJoin] = useState(false);

  const load = useCallback(async (p: string) => {
    setState({ kind: "loading" });
    try {
      const res = await fetch(`/api/directory/list?phone=${encodeURIComponent(p)}`);
      const data = (await res.json().catch(() => null)) as DirPayload | null;
      if (res.status === 403) {
        setState({ kind: "forbidden" });
      } else if (res.ok && data?.ok) {
        setState({ kind: "ready", data });
      } else {
        setState({
          kind: "unavailable",
          message: data?.error ?? "Couldn't load the community — the database didn't answer.",
        });
      }
    } catch {
      setState({ kind: "unavailable", message: "No connection right now — the community will be here when you're back." });
    }
  }, []);

  const data = state.kind === "ready" ? state.data : null;
  const admin = data?.role === "admin";
  const firstName = data?.name ? data.name.split(" ")[0] : null;

  const rows = useMemo(() => {
    const all = data?.members ?? [];
    const q = query.trim().toLowerCase();
    return all.filter((m) => {
      if (filter !== "all" && (m.kind ?? "") !== filter) return false;
      if (q && !(m.display_name ?? "").toLowerCase().includes(q)) return false;
      return true;
    });
  }, [data, query, filter]);

  const pauseResume = async (m: Member, pauseIt: boolean) => {
    if (!m.phone) return;
    setActing(true);
    setActionError(null);
    try {
      const res = await fetch(pauseIt ? "/api/directory/pause" : "/api/directory/resume", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ phone, target: m.phone }),
      });
      const d = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (res.ok && d?.ok) {
        setDetail(null);
        await load(phone);
      } else {
        setActionError(d?.error ?? "That didn't go through — nothing changed.");
      }
    } catch {
      setActionError("No connection — nothing changed.");
    } finally {
      setActing(false);
    }
  };

  const subLine = (m: Member): string => {
    const kind = kindLabel(m.kind);
    const stateWord = m.active === false ? "paused" : "active";
    if (!admin) return `${kind} · ${stateWord}`;
    if (m.kind === "staff") return `Outreach · ${stateWord === "active" ? "on the team" : "paused"}`;
    if (m.kind === "hometeam") {
      const hours = m.consents_to_after_hours ? "after-hours ok" : "business-hours only";
      return `HomeTeam · ${stateWord} · ${hours}`;
    }
    if (m.opted_in) {
      const when = m.opted_in_at ? ` ${dateLabel(m.opted_in_at)}` : "";
      const hours = m.consents_to_after_hours ? " · after-hours ok" : "";
      return `Neighbor · opted in${when}${hours}`;
    }
    return "Not opted in — cannot message";
  };

  return (
    <AppShell>
      <div className="flex flex-col gap-4 px-4 pt-5">
        <header className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-h1">Community</h1>
            <p className="mt-0.5 text-small text-sg-ink-soft">
              HomeTeam supporters and neighbors who opted in to updates.
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

        {phone.length < 10 ? (
          <EmptyState
            icon={<HandsIcon size={28} />}
            title="Whose community is this?"
            body="Enter the outreach phone you use with the team, so we can check you're on the roster."
          />
        ) : state.kind === "loading" || state.kind === "idle" ? (
          <SkeletonRows rows={4} />
        ) : state.kind === "forbidden" ? (
          <EmptyState
            icon={<HandsIcon size={28} />}
            title="This space is for the outreach team."
            body="That number isn't on the outreach roster — if you're on the team, check the number and try again, no rush."
          />
        ) : state.kind === "unavailable" ? (
          <EmptyState
            icon={<HandsIcon size={28} />}
            title="The community isn't up yet"
            body={state.message}
            steps={<Button variant="secondary" full onClick={() => void load(phone)}>Try again</Button>}
          />
        ) : data ? (
          <>
            {(data.members ?? []).length === 0 ? (
              <EmptyState
                icon={<HandsIcon size={28} />}
                title="No community contacts yet"
                body="When neighbors join the HomeTeam or opt in to updates, they'll appear here."
                steps={
                  admin ? (
                    <Button variant="quiet" full onClick={() => setHowJoin(true)}>
                      How do people join?
                    </Button>
                  ) : undefined
                }
              />
            ) : (
              <>
                <SearchField value={query} onChange={setQuery} placeholder="Search name…" />
                <div className="flex gap-2" role="group" aria-label="Filter by kind">
                  {(["all", "hometeam", "neighbor", "staff"] as Filter[]).map((f) => (
                    <button
                      key={f}
                      type="button"
                      aria-pressed={filter === f}
                      onClick={() => setFilter(f)}
                      className={
                        filter === f
                          ? "min-h-[48px] flex-1 rounded-[12px] border-2 border-sg-sage bg-sg-sage-wash px-2 text-btn font-medium text-sg-sage-deep"
                          : "min-h-[48px] flex-1 rounded-[12px] border-2 border-sg-line bg-sg-card px-2 text-btn text-sg-ink"
                      }
                    >
                      {f === "all" ? "All" : f === "hometeam" ? "HomeTeam" : f === "neighbor" ? "Neighbors" : "Staff"}
                    </button>
                  ))}
                </div>
                {rows.length === 0 ? (
                  <EmptyState
                    icon={<CheckCircleIcon size={28} />}
                    title="No names match that search"
                    body="Try a shorter name — the search only looks at names already loaded here."
                  />
                ) : (
                  <ul className="flex flex-col gap-2">
                    {rows.map((m, i) => {
                      const name = m.display_name || "A neighbor";
                      const tappable = admin && m.kind !== "staff";
                      const inner = (
                        <>
                          <span
                            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[12px] bg-sg-sage-wash text-h2 text-sg-sage"
                            aria-hidden
                          >
                            {name.trim().charAt(0).toUpperCase() || "·"}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-body font-medium">{name}</span>
                            <span className="block truncate text-small text-sg-ink-soft">{subLine(m)}</span>
                          </span>
                        </>
                      );
                      return (
                        <li key={`${m.kind}-${m.display_name}-${i}`}>
                          {tappable ? (
                            <button
                              type="button"
                              onClick={() => setDetail(m)}
                              className="flex w-full items-center gap-3 rounded-[16px] border border-sg-line bg-sg-card p-3 text-left shadow-[0_1px_2px_rgba(30,42,50,0.08)]"
                            >
                              {inner}
                              <span className="shrink-0 text-sg-ink-soft" aria-hidden>›</span>
                            </button>
                          ) : (
                            <div
                              className="flex w-full items-center gap-3 rounded-[16px] border border-sg-line bg-sg-card p-3"
                              aria-disabled={admin ? undefined : true}
                            >
                              {inner}
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
                {admin ? (
                  <div className="sticky bottom-3 flex flex-col gap-2">
                    <Link to="/outreach/directory/notice" search={{ phone }} className="block w-full">
                      <Button full>Send a group notice</Button>
                    </Link>
                    <Link to="/outreach/directory/notices" search={{ phone }} className="block w-full">
                      <Button variant="secondary" full>See sent notices</Button>
                    </Link>
                  </div>
                ) : null}
              </>
            )}
          </>
        ) : null}

        <BottomSheet open={detail !== null && admin} onClose={() => setDetail(null)} title={detail?.display_name || "Member"}>
          {detail ? (
            <div className="flex flex-col gap-3">
              <dl className="flex flex-col gap-2 text-body">
                <div className="flex gap-2">
                  <dt className="w-24 shrink-0 font-medium">Kind</dt>
                  <dd>{kindLabel(detail.kind)}</dd>
                </div>
                {detail.phone ? (
                  <div className="flex gap-2">
                    <dt className="w-24 shrink-0 font-medium">Phone</dt>
                    <dd>
                      <a href={`tel:${detail.phone}`} className="text-sg-sky underline underline-offset-2">
                        {formatPhone(detail.phone)}
                      </a>
                    </dd>
                  </div>
                ) : null}
                <div className="flex gap-2">
                  <dt className="w-24 shrink-0 font-medium">Status</dt>
                  <dd>{detail.active === false ? "Paused — gets no notices." : "Active."}</dd>
                </div>
                {detail.kind !== "staff" ? (
                  <div className="flex gap-2">
                    <dt className="w-24 shrink-0 font-medium">Updates</dt>
                    <dd className="text-sg-ink-soft">
                      {detail.opted_in
                        ? `Opted in${detail.opted_in_at ? ` ${dateLabel(detail.opted_in_at)}` : ""} · ${detail.consents_to_after_hours ? "after-hours ok" : "business hours only"}`
                        : "Not opted in — cannot message."}
                    </dd>
                  </div>
                ) : null}
              </dl>
              {detail.kind === "hometeam" && detail.phone ? (
                detail.active === false ? (
                  <Button variant="secondary" full disabled={acting} onClick={() => void pauseResume(detail, false)}>
                    Resume — welcome them back
                  </Button>
                ) : (
                  <Button variant="quiet" full disabled={acting} onClick={() => void pauseResume(detail, true)}>
                    Pause — stop notices for now
                  </Button>
                )
              ) : null}
              <Button variant="quiet" full onClick={() => setDetail(null)}>
                Close
              </Button>
            </div>
          ) : null}
        </BottomSheet>

        <BottomSheet open={howJoin} onClose={() => setHowJoin(false)} title="How do people join?">
          <div className="flex flex-col gap-3 text-body">
            <p>Neighbors join the HomeTeam from the app — they add a name and a phone, and choose to get updates by app notification.</p>
            <p>Others opt in from the check-in or peer-support screens: “MPRCC can send me group updates by app notification,” with a separate after-hours choice that stays off unless they ask.</p>
            <p className="text-small text-sg-ink-soft">No row, no notices — ever. Nobody is added by hand.</p>
            <Button variant="quiet" full onClick={() => setHowJoin(false)}>
              Close
            </Button>
          </div>
        </BottomSheet>
      </div>
    </AppShell>
  );
}

export const Route = createFileRoute("/outreach/directory")({ component: DirectoryPage });
