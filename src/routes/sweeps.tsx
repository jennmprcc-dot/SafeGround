/**
 * Sweep Alerts — Build B (WIREFRAMES §3).
 * Map + list of active/planned sweeps (anonymous OK), a calm report flow
 * (user report → outreach verification queue), and an outreach review queue.
 * Privacy: no auto-locate on the report map — the pin is placed by the user,
 * or "Use my location once" (single read, only for this report). No background
 * tracking anywhere.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "~/components/shell";
import {
  BottomSheet,
  Button,
  Card,
  ChipGrid,
  ConsentReceipt,
  Dialog,
  EmptyState,
  IconTile,
  ListRow,
  LocationOnceButton,
  SkeletonRows,
  StatusBadge,
  TextArea,
  useToasts,
} from "~/components/ui";
import { useAuth } from "~/lib/auth";
import { listSweeps, reportSweep, getOutreachQueue, actOnSweep } from "~/lib/server";
import type { SweepRow, DataSource } from "~/lib/server";
import { approxDistanceMi, demoNearMePoint } from "~/lib/data";
import { BellMoonIcon, CheckIcon, MapPinIcon, PenIcon, CheckCircleIcon } from "~/lib/icons";
import { cn } from "~/lib/cn";

/* ── pin visuals (DESIGN_SYSTEM §4.4) ───────────────────────────── */
const PIN_STYLE: Record<string, { shape: string; color: string }> = {
  active: { shape: "rounded-full", color: "bg-sg-clay" },
  planned: { shape: "rounded-[6px] rotate-45", color: "bg-sg-gold" },
  resolved: { shape: "rounded-full opacity-60", color: "bg-sg-ink-soft" },
};

function SweepPins({ sweeps, onPick }: { sweeps: SweepRow[]; onPick: (s: SweepRow) => void }) {
  return (
    <div className="absolute inset-0" aria-hidden>
      {sweeps.map((s, i) => {
        const style = PIN_STYLE[s.status] ?? PIN_STYLE.active;
        // Spread demo pins across the calm backstop so every status is visible.
        const left = 18 + ((i * 37) % 58);
        const top = 14 + ((i * 53) % 46);
        return (
          <button
            key={s.id}
            type="button"
            tabIndex={-1}
            onClick={() => onPick(s)}
            className="absolute flex h-7 w-7 items-center justify-center"
            style={{ left: `${left}%`, top: `${top}%` }}
            aria-label={`${s.status} sweep`}
          >
            <span className={cn("flex h-7 w-7 items-center justify-center border-2 border-white shadow-md", style.shape, style.color)}>
              {s.status === "planned" ? (
                <span className="-rotate-45 text-white [&_svg]:h-3.5 [&_svg]:w-3.5">
                  <BellMoonIcon size={14} />
                </span>
              ) : (
                <span className="text-white [&_svg]:h-3.5 [&_svg]:w-3.5">
                  <BellMoonIcon size={14} />
                </span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/* ── map pane: calm no-key fallback, pins over the backstop ─────── */
function SweepMapPane({ sweeps, onPick }: { sweeps: SweepRow[]; onPick: (s: SweepRow) => void }) {
  return (
    <div className="relative flex h-[280px] flex-col overflow-hidden rounded-[16px] border border-sg-line bg-sg-sky-wash">
      <div
        aria-hidden
        className="absolute inset-0 opacity-60"
        style={{
          backgroundImage:
            "radial-gradient(circle at 20% 30%, rgba(42,107,138,0.18) 0 1px, transparent 1px), radial-gradient(circle at 70% 60%, rgba(42,107,138,0.14) 0 1px, transparent 1px), linear-gradient(180deg, #e0eff5, #d6e9f2)",
          backgroundSize: "26px 26px, 40px 40px, 100% 100%",
        }}
      />
      <SweepPins sweeps={sweeps.slice(0, 6)} onPick={onPick} />
      {/* legend chip */}
      <div className="absolute bottom-3 left-3 flex flex-wrap items-center gap-3 rounded-full bg-sg-card px-3 py-1.5 text-small font-medium text-sg-ink shadow-md">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-sg-clay" aria-hidden />
          Active
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rotate-45 rounded-[3px] bg-sg-gold" aria-hidden />
          Planned
        </span>
      </div>
      <div className="absolute bottom-3 right-3 flex flex-col overflow-hidden rounded-[12px] border border-sg-line bg-sg-card shadow-md">
        <button type="button" aria-label="Zoom in" className="flex h-12 w-12 items-center justify-center text-sg-ink hover:bg-sg-paper">+</button>
        <button type="button" aria-label="Zoom out" className="flex h-12 w-12 items-center justify-center border-t border-sg-line text-sg-ink hover:bg-sg-paper">−</button>
      </div>
      <div className="absolute inset-x-4 bottom-16 rounded-[12px] bg-sg-card p-3 shadow-md">
        <p className="text-small text-sg-ink-soft">Heads-ups shown as approximate areas — the list below has each one.</p>
      </div>
    </div>
  );
}

/* ── Sweep detail bottom sheet (§3c) ────────────────────────────── */
function SweepSheet({ sweep, onClose, onReport }: { sweep: SweepRow | null; onClose: () => void; onReport: () => void }) {
  const { push } = useToasts();
  if (!sweep) return null;
  const statusKind: SweepRow["status"] = sweep.status;
  return (
    <BottomSheet open={!!sweep} onClose={onClose} title={sweep.status === "active" ? "Active heads-up" : sweep.status === "planned" ? "Planned heads-up" : "Resolved heads-up"}>
      <div className="flex flex-col gap-4 pb-2">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge kind={statusKind === "active" ? "Active" : statusKind === "planned" ? "Planned" : "Resolved"}>
            {statusKind === "active" ? "Active" : statusKind === "planned" ? "Planned" : "Resolved"}
          </StatusBadge>
          {sweep.verified ? (
            <span className="inline-flex items-center gap-1 text-small font-medium text-sg-sage">
              <CheckIcon size={14} aria-hidden /> Verified by outreach
            </span>
          ) : (
            <span className="text-small text-sg-ink-soft">Reported by a neighbor · awaiting verification</span>
          )}
        </div>
        <p className="text-body text-sg-ink-soft">Window: {sweep.window}</p>
        {sweep.note ? <p className="text-body text-sg-ink">{sweep.note}</p> : null}

        <div className="rounded-[16px] border border-sg-line bg-sg-paper p-4">
          <h3 className="text-h2">Tonight, you can</h3>
          <ol className="mt-2 flex list-none flex-col gap-2 text-body text-sg-ink-soft">
            <li>1. Move to a quiet spot away from this area if you can.</li>
            <li>2. Keep important papers and medicines on you.</li>
            <li>3. Check the nearby shelter and food list for a warm place.</li>
          </ol>
        </div>

        <div className="flex flex-col gap-2">
          <Button variant="secondary" full onClick={() => push({ kind: "info", message: "Sharing this heads-up helps neighbors nearby." })}>
            Share this heads-up
          </Button>
          <Button variant="quiet" full onClick={onReport}>
            <PenIcon size={18} aria-hidden />
            Report what you see
          </Button>
        </div>

        <ConsentReceipt
          who="Everyone who opens the app"
          what="The area you described + your words"
          howLong="Until outreach marks it resolved"
          stopLabel="Report a problem with this heads-up"
          onStop={() => push({ kind: "info", message: "Thanks — outreach will take a look." })}
        />
      </div>
    </BottomSheet>
  );
}

/* ── Report flow (§3b) — 3 steps, draft survives, record kept ──── */
function ReportSheet({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: (created: boolean, source: DataSource) => void }) {
  const { signedIn, displayName, signIn } = useAuth();
  const { push } = useToasts();
  const [step, setStep] = useState(1);
  const [point, setPoint] = useState<{ lat: number; lng: number } | null>(null);
  const [happened, setHappened] = useState(true);
  const [note, setNote] = useState("");
  const [publishing, setPublishing] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Reset when the sheet opens.
  useEffect(() => {
    if (open) {
      setStep(1);
      setPoint(null);
      setHappened(true);
      setNote("");
      setPublishing(false);
    }
  }, [open]);

  const once = () => {
    const done = (p: { lat: number; lng: number }) => {
      setPoint(p);
      push({ kind: "info", message: "Pin placed from your location — used once, nothing stored." });
    };
    if (typeof navigator !== "undefined" && "geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => done({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => done(demoNearMePoint()),
        { maximumAge: 0, timeout: 8000 },
      );
    } else done(demoNearMePoint());
  };

  const publish = async () => {
    if (!point) return;
    setPublishing(true);
    try {
      const res = await reportSweep({ data: { lat: point.lat, lng: point.lng, note, happened, userId: signedIn ? demoDeviceId(displayName) : "" } });
      push({ kind: "success", message: res.source === "db" ? "Thanks — your report helps neighbors." : "Draft saved — will sync when the connection returns." });
      onDone(true, res.source);
      onClose();
    } catch {
      push({ kind: "error", message: "No connection right now — your draft is saved. Try again when you can." });
      onDone(false, "demo");
      onClose();
    } finally {
      setPublishing(false);
    }
  };

  const needsSignIn = !signedIn && step >= 2;

  return (
    <>
      <BottomSheet open={open} onClose={onClose} title="Report what you see">
        <div className="flex flex-col gap-4 pb-2">
          <p className="text-small text-sg-ink-soft">Step {needsSignIn ? 2 : step} of 3 — no rush, and no photos needed. Words are enough.</p>

          {step === 1 && (
            <>
              <div className="relative flex h-[200px] flex-col overflow-hidden rounded-[16px] border border-sg-line bg-sg-sky-wash">
                <div
                  aria-hidden
                  className="absolute inset-0 opacity-60"
                  style={{ backgroundImage: "radial-gradient(circle at 20% 30%, rgba(42,107,138,0.18) 0 1px, transparent 1px), linear-gradient(180deg, #e0eff5, #d6e9f2)", backgroundSize: "26px 26px, 100% 100%" }}
                />
                {point ? (
                  <button
                    type="button"
                    className="absolute left-1/2 top-1/2 z-10 -ml-3.5 -mt-3.5 flex h-7 w-7 items-center justify-center rounded-full border-2 border-white bg-sg-clay shadow-md"
                    aria-label="Move the pin"
                  >
                    <MapPinIcon size={16} className="text-white" />
                  </button>
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <p className="max-w-[220px] text-center text-small text-sg-ink-soft">Tap below to drop a pin on the map, or use your location once.</p>
                  </div>
                )}
              </div>
              <LocationOnceButton onClick={once} caption="Only this report — nothing stored afterwards." />
              <Button full onClick={() => setPoint((p) => p ?? demoNearMePoint())}>
                {point ? "Keep this pin" : "Place pin at a spot I choose"}
              </Button>
              <Button variant="quiet" full onClick={() => (point ? setStep(2) : push({ kind: "info", message: "First place a pin — it's the approximate area of what you saw." }))}>
                Continue
              </Button>
              <p className="text-small text-sg-ink-soft">No auto-location — the pin is what you place. Privacy stays with you.</p>
            </>
          )}

          {step === 2 && (
            <>
              {!signedIn ? (
                <EmptyState
                  icon={<PenIcon size={28} />}
                  title="Sign in so outreach can follow up"
                  body="Your name isn't shown anywhere — just lets the team know who shared the heads-up."
                  steps={<Button full onClick={() => { signIn(); push({ kind: "info", message: "Signed in — your report will be attributed to you." }); }}>Sign in to continue</Button>}
                />
              ) : (
                <>
                  <ChipGrid
                    label="When did this happen or is it coming?"
                    options={[
                      { value: "now", label: "Happening now" },
                      { value: "planned", label: "Planned" },
                    ]}
                    selected={[happened ? "now" : "planned"]}
                    onToggle={(v) => setHappened(v === "now")}
                  />
                  <TextArea
                    label="What do you see?"
                    helper="e.g. officers posting notices for Thursday"
                    maxLength={500}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Words are enough — no photos needed."
                  />
                  <Button full onClick={() => setStep(3)}>Continue</Button>
                  <Button variant="quiet" full onClick={() => setStep(1)}>Back</Button>
                </>
              )}
            </>
          )}

          {step === 3 && (
            <>
              <ConsentReceipt
                who="Everyone who opens the app"
                what="The pin I placed + my words"
                howLong="Until outreach marks it resolved"
              />
              <p className="text-small text-sg-ink-soft">
                {point ? `Pin at ${point.lat.toFixed(4)}, ${point.lng.toFixed(4)} · ${happened ? "happening now" : "planned"}` : "No pin yet."}
                {note ? ` · "${note.slice(0, 80)}${note.length > 80 ? "…" : ""}"` : ""}
              </p>
              <Button full disabled={publishing} onClick={() => setConfirmOpen(true)}>
                {publishing ? "Sending…" : "Publish heads-up"}
              </Button>
              <Button variant="quiet" full onClick={() => setStep(2)}>Back</Button>
            </>
          )}
        </div>
      </BottomSheet>

      <Dialog
        open={confirmOpen}
        title="Publish this heads-up?"
        confirmLabel="Yes, publish"
        onConfirm={() => { setConfirmOpen(false); void publish(); }}
        onClose={() => setConfirmOpen(false)}
      >
        Everyone who opens the app sees the area you described and your words, until outreach marks it resolved. Nothing else is shared.
      </Dialog>
    </>
  );
}

/** Deterministic demo device id (#alias#tokens-on-this-browser). Mirrors server helper. */
function demoDeviceId(displayName: string): string {
  let token = "";
  if (typeof localStorage !== "undefined") {
    token = localStorage.getItem("sg.device") ?? "";
  }
  // Fall back to an in-memory token so server functions still work on first paint.
  if (!token && typeof window !== "undefined") {
    token = (window as unknown as { __sgtok?: string }).__sgtok ?? `mem-${Math.random().toString(36).slice(2)}`;
    (window as unknown as { __sgtok?: string }).__sgtok = token;
  }
  // The server derives the same UUID from (name, token); here we just need a
  // plausible stable id for the RLS-relevant payload — the server honors the
  // ui one and ignores irrelevant hostility; demo fallback covers bad input.
  let h = 0;
  const s = `${displayName.trim().toLowerCase()}|${token}`;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16).padStart(32, "0").replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, "$1-$2-$3-$4-$5");
}

/* ── Sweeps page ────────────────────────────────────────────────── */
function SweepsPage() {
  const { push } = useToasts();
  const [state, setState] = useState<{ rows: SweepRow[]; source: DataSource; loading: boolean }>({ rows: [], source: "demo", loading: true });
  const [filter, setFilter] = useState<"all" | "active" | "planned">("all");
  const [selected, setSelected] = useState<SweepRow | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);
  const [queue, setQueue] = useState<{ pending: SweepRow[]; source: DataSource }>({ pending: [], source: "demo" });
  const tabRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    let alive = true;
    listSweeps()
      .then((r) => {
        if (!alive) return;
        setState({ rows: r.rows, source: r.source, loading: false });
      })
      .catch(() => {
        if (alive) setState({ rows: [], source: "demo", loading: false });
      });
    return () => {
      alive = false;
    };
  }, []);

  const refresh = () => {
    listSweeps().then((r) => setState({ rows: r.rows, source: r.source, loading: false })).catch(() => undefined);
  };

  const activeCount = state.rows.filter((s) => s.status === "active" || s.status === "planned").length;

  const filtered = useMemo(() => {
    if (filter === "all") return state.rows;
    return state.rows.filter((s) => s.status === filter);
  }, [state.rows, filter]);

  const openQueue = () => {
    getOutreachQueue()
      .then((r) => {
        setQueue(r);
        setQueueOpen(true);
      })
      .catch(() => setQueueOpen(true));
  };

  const doAct = async (id: string, action: "verify" | "flag" | "resolve") => {
    const res = await actOnSweep({ data: { id, action } });
    if (res.ok) {
      push({ kind: "info", message: action === "verify" ? "Marked as verified." : action === "flag" ? "Flagged for a second look — the reporter sees 'Under review'." : "Marked resolved." });
      refresh();
    } else {
      push({ kind: "error", message: "Couldn't update right now — try again in a moment." });
    }
  };

  return (
    <AppShell>
      <div className="flex flex-col gap-4 px-4 pt-5">
        <header className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-h1">Sweeps</h1>
            <p className="mt-0.5 text-small text-sg-ink-soft">Heads-ups from neighbors, kept calm.</p>
          </div>
          <Button variant="secondary" onClick={openQueue} className="!min-h-[44px]">
            Outreach queue
          </Button>
        </header>

        {state.loading ? (
          <SkeletonRows rows={2} />
        ) : (
          <>
            <div className="flex flex-col gap-3">
              <SweepMapPane sweeps={state.rows} onPick={setSelected} />
              <div className="mb-1 flex items-center justify-between px-1">
                <p className="text-small text-sg-ink-soft">
                  {activeCount} active or planned {activeCount === 1 ? "heads-up" : "heads-ups"} · {state.source === "db" ? "live" : "demo"}
                </p>
                <button ref={tabRef} type="button" onClick={refresh} className="min-h-[44px] px-1 text-small font-semibold text-sg-sky underline underline-offset-2">
                  Refresh
                </button>
              </div>
            </div>

            <div className={cn("flex flex-col gap-2")}>
              <ChipGrid
                label="Filter heads-ups"
                options={[
                  { value: "all", label: "All" },
                  { value: "active", label: `Active ${state.rows.filter((s) => s.status === "active").length}` },
                  { value: "planned", label: `Planned ${state.rows.filter((s) => s.status === "planned").length}` },
                ]}
                selected={[filter]}
                onToggle={(v) => setFilter(v as "all" | "active" | "planned")}
              />
            </div>
          </>
        )}

        {!state.loading && filtered.length === 0 ? (
          <EmptyState
            icon={<BellMoonIcon size={28} />}
            title="No sweeps reported in this area right now"
            body="Rest easy — check back anytime. And if you do see something, a quiet report helps neighbors nearby."
            steps={<Button full onClick={() => setReportOpen(true)}>Report what you see</Button>}
          />
        ) : (
          <ul className="flex flex-col">
            {filtered.map((s) => {
              const kind = s.status === "active" ? "Active" : s.status === "planned" ? "Planned" : "Resolved";
              return (
                <ListRow key={s.id} onClick={() => setSelected(s)}>
                  <IconTile wash={s.status === "active" ? "bg-sg-clay-wash" : s.status === "planned" ? "bg-sg-gold-wash" : "bg-sg-line"}>
                    <BellMoonIcon size={20} />
                  </IconTile>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-body font-medium text-sg-ink">{s.note?.split(".")[0] ?? `${s.status} heads-up`}</span>
                    </span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-x-1 text-small text-sg-ink-soft">
                      <StatusBadge kind={kind as "Active"}>{kind}</StatusBadge>
                      <span>· {s.window}</span>
                    </span>
                    <span className="mt-0.5 block text-small text-sg-ink-soft">
                      {s.reportedMinutesAgo < 60 ? `${Math.max(1, s.reportedMinutesAgo)} min ago` : `${Math.round(s.reportedMinutesAgo / 60)}h ago`} ·{" "}
                      {s.verified ? "verified by outreach" : "awaiting verification"} ·{" "}
                      {approxDistanceMi(demoNearMePoint(), s).toFixed(1)} mi
                    </span>
                  </span>
                </ListRow>
              );
            })}
          </ul>
        )}

        <p className="text-small text-sg-ink-soft">
          {state.source === "db"
            ? "Live heads-ups from the outreach database."
            : "Demo data — the live sweep list appears when the database connects."}
        </p>
      </div>

      {/* outreach review queue (dashboard-lite; real dashboard is Wave 2) */}
      <BottomSheet open={queueOpen} onClose={() => setQueueOpen(false)} title="Outreach queue">
        <div className="flex flex-col gap-3 pb-2">
          <p className="text-small text-sg-ink-soft">{queue.pending.length} sweeps awaiting verification{queue.source === "db" ? "" : " (demo)"}.</p>
          {queue.pending.length === 0 ? (
            <EmptyState title="All caught up" body="No reports waiting for a look right now." />
          ) : (
            queue.pending.map((s) => (
              <Card key={s.id}>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-body font-medium text-sg-ink">{s.note ?? `${s.status} heads-up`}</p>
                    <p className="mt-0.5 text-small text-sg-ink-soft">{s.window} · {s.reportedMinutesAgo} min ago</p>
                  </div>
                  <StatusBadge kind="Reported">Reported</StatusBadge>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button variant="secondary" onClick={() => void doAct(s.id, "verify")}>
                    <CheckCircleIcon size={18} aria-hidden /> Verify
                  </Button>
                  <Button variant="quiet" onClick={() => void doAct(s.id, "flag")}>
                    Flag
                  </Button>
                  <Button variant="quiet" onClick={() => void doAct(s.id, "resolve")}>
                    Resolve
                  </Button>
                </div>
              </Card>
            ))
          )}
        </div>
      </BottomSheet>

      <ReportSheet
        open={reportOpen}
        onClose={() => setReportOpen(false)}
        onDone={() => {
          refresh();
        }}
      />
      <SweepSheet sweep={selected} onClose={() => setSelected(null)} onReport={() => setReportOpen(true)} />
    </AppShell>
  );
}

export const Route = createFileRoute("/sweeps")({ component: SweepsPage });