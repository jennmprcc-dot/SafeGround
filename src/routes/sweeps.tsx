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
import { listSweeps, reportSweep } from "~/lib/server";
import type { SweepRow, DataSource } from "~/lib/server";
import { useLanguage } from "~/lib/i18n";
import { BellMoonIcon, MapPinIcon, PenIcon } from "~/lib/icons";
import { cn } from "~/lib/cn";
import { SubmitConfirm, type SubmitConfirmState } from "~/components/submitConfirm";
import { logAnonymousEvent } from "~/lib/analytics/logger";

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
        // Spread pins across the calm backstop so every status is visible.
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
  const { t } = useLanguage();
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
          {t("sw_active")}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rotate-45 rounded-[3px] bg-sg-gold" aria-hidden />
          {t("sw_planned")}
        </span>
      </div>
      {/* A11y: no zoom controls here — the decorative pane + sweep list
       * rows below already give full keyboard/SR access (never leave
       * focusable buttons with no action). */}
      <div className="absolute inset-x-4 bottom-16 rounded-[12px] bg-sg-card p-3 shadow-md">
        <p className="text-small text-sg-ink-soft">{t("sw_map_note")}</p>
      </div>
    </div>
  );
}

/* ── sweep trust badges (two-tier, calm, never alarming) ──────────
 * Tier 1 — verified by MPRCC outreach. Tier 2 — a neighbor's report that
 * outreach hasn't confirmed yet. We never say bare "Unverified". */
function SweepTrustBadge({ verified }: { verified: boolean }) {
  const { t } = useLanguage();
  if (verified) {
    return <StatusBadge kind="Verified">{t("badge_verified")}</StatusBadge>;
  }
  return (
    <span className="inline-flex flex-col gap-1">
      <StatusBadge kind="Reported">{t("badge_community")}</StatusBadge>
      <span className="text-small text-sg-ink-soft">{t("badge_community_sub")}</span>
    </span>
  );
}

/* ── Sweep detail bottom sheet (§3c) ────────────────────────────── */
function SweepSheet({
  sweep,
  onClose,
  onReport,
}: {
  sweep: SweepRow | null;
  onClose: () => void;
  /* Opened with the sweep's context (window + note) so the problem report
   * pre-fills the real flow — never a toast-only dead end (owner P0). */
  onReport: (sweep: SweepRow) => void;
}) {
  const { push } = useToasts();
  const { t } = useLanguage();
  if (!sweep) return null;
  const statusKind: SweepRow["status"] = sweep.status;
  const sheetTitle = statusKind === "active" ? t("sw_sheet_active") : statusKind === "planned" ? t("sw_sheet_planned") : t("sw_sheet_resolved");
  const statusLabel = statusKind === "active" ? t("sw_active") : statusKind === "planned" ? t("sw_planned") : t("sw_resolved");
  return (
    <BottomSheet open={!!sweep} onClose={onClose} title={sheetTitle}>
      <div className="flex flex-col gap-4 pb-2">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge kind={statusKind === "active" ? "Active" : statusKind === "planned" ? "Planned" : "Resolved"}>
            {statusLabel}
          </StatusBadge>
          <SweepTrustBadge verified={sweep.verified} />
        </div>
        <p className="text-body text-sg-ink-soft">{t("sw_window")} {sweep.window}</p>
        {sweep.note ? <p className="text-body text-sg-ink">{sweep.note}</p> : null}

        <div className="rounded-[16px] border border-sg-line bg-sg-paper p-4">
          <h3 className="text-h2">{t("sw_tonight_title")}</h3>
          <ol className="mt-2 flex list-none flex-col gap-2 text-body text-sg-ink-soft">
            <li>1. {t("sw_tip1")}</li>
            <li>2. {t("sw_tip2")}</li>
            <li>3. {t("sw_tip3")}</li>
          </ol>
        </div>

        <div className="flex flex-col gap-2">
          <Button variant="secondary" full onClick={() => push({ kind: "info", message: t("sw_share_toast") })}>
            {t("sw_share")}
          </Button>
          <Button variant="quiet" full onClick={() => onReport(sweep)}>
            <PenIcon size={18} aria-hidden />
            {t("sw_report_cta")}
          </Button>
        </div>

        <ConsentReceipt
          who={t("sw_consent_who")}
          what={t("sw_consent_what")}
          howLong={t("sw_consent_how")}
          stopLabel={t("sw_report_problem")}
          onStop={() => onReport(sweep)}
        />
      </div>
    </BottomSheet>
  );
}

/* ── Report flow (§3b) — 3 steps, draft survives, record kept ────
 * Anonymous-first (owner P0): no sign-in gate. reportSweep attributes
 * signed-in reporters by device id and stays anonymous (null reported_by)
 * for everyone else. */
function ReportSheet({
  open,
  onClose,
  onDone,
  seedNote,
}: {
  open: boolean;
  onClose: () => void;
  onDone: (created: boolean, source: DataSource) => void;
  seedNote?: string;
}) {
  const { signedIn, displayName } = useAuth();
  const { push } = useToasts();
  const { t } = useLanguage();
  const [step, setStep] = useState(1);
  const [point, setPoint] = useState<{ lat: number; lng: number } | null>(null);
  const [happened, setHappened] = useState(true);
  const [note, setNote] = useState("");
  const [publishing, setPublishing] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [done, setDone] = useState<SubmitConfirmState | null>(null);

  // Reset when the sheet opens (problem-report seeds carry the heads-up's
  // window as context so outreach sees which heads-up it's about).
  useEffect(() => {
    if (open) {
      setStep(1);
      setPoint(null);
      setHappened(true);
      setNote(seedNote ?? "");
      setPublishing(false);
      setDone(null);
    }
  }, [open, seedNote]);

  /* REAL location only: a single user-initiated device read places the pin for
   * this report. Nothing is stored afterwards. If the read fails or isn't
   * available, the sender places the pin themselves — no invented point is
   * ever substituted. */
  const once = () => {
    const fail = () => {
      push({ kind: "info", message: t("sw_loc_fail") });
    };
    const done = (p: { lat: number; lng: number }) => {
      setPoint(p);
      push({ kind: "info", message: t("sw_pin_ok") });
    };
    if (typeof navigator !== "undefined" && "geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => done({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        fail,
        { maximumAge: 0, timeout: 8000 },
      );
    } else fail();
  };

  const publish = async () => {
    if (!point) return;
    setPublishing(true);
    try {
      const res = await reportSweep({ data: { lat: point.lat, lng: point.lng, note, happened, userId: signedIn ? demoDeviceId(displayName) : "" } });
      // Persistent confirmation (owner-directed): the sheet flips to a success
      // state that STAYS — not just a toast. Sweeps city list + outreach queue
      // both share the row; there is no separate team push channel for reports.
      setDone({ saved: res.source === "db", kind: res.source === "db" ? "saved" : "draft" });
      onDone(true, res.source);
    } catch {
      setDone({ saved: false, kind: "draft", line: t("sw_offline_draft") });
      onDone(false, "demo");
    } finally {
      setPublishing(false);
    }
  };

  return (
    <>
      <BottomSheet open={open} onClose={onClose} title={t("sw_report_title")}>
        <div className="flex flex-col gap-4 pb-2">
          {done ? (
            <>
              <SubmitConfirm state={done} />
              <p className="text-small text-sg-ink-soft">
                {done.kind === "draft"
                  ? t("sw_draft_stays")
                  : t("sw_live_now")}
              </p>
              <Button variant="quiet" full onClick={onClose}>
                {t("sw_close")}
              </Button>
            </>
          ) : (
            <>
          <p className="text-small text-sg-ink-soft" role="status">{t("sw_step")} {step} {t("sw_step_suffix")}</p>

          {step === 1 && (
            <>
              <div className="relative flex h-[200px] flex-col overflow-hidden rounded-[16px] border border-sg-line bg-sg-sky-wash">
                <div
                  aria-hidden
                  className="absolute inset-0 opacity-60"
                  style={{ backgroundImage: "radial-gradient(circle at 20% 30%, rgba(42,107,138,0.18) 0 1px, transparent 1px), linear-gradient(180deg, #e0eff5, #d6e9f2)", backgroundSize: "26px 26px, 100% 100%" }}
                />
                {point ? (
                  /* A11y: static marker, not a button — the LocationOnceButton
                   * below is the working path for placing the pin. */
                  <span
                    aria-hidden
                    className="absolute left-1/2 top-1/2 z-10 -ml-3.5 -mt-3.5 flex h-7 w-7 items-center justify-center rounded-full border-2 border-white bg-sg-clay shadow-md"
                  >
                    <MapPinIcon size={16} className="text-white" />
                  </span>
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <p className="max-w-[220px] text-center text-small text-sg-ink-soft">{t("sw_pin_hint")}</p>
                  </div>
                )}
              </div>
              <LocationOnceButton onClick={once} caption={t("sw_loc_caption")} />
              <Button full onClick={() => { if (!point) push({ kind: "info", message: t("sw_need_pin") }); }}>
                {point ? t("sw_keep_pin") : t("sw_place_pin")}
              </Button>
              <Button variant="quiet" full onClick={() => (point ? setStep(2) : push({ kind: "info", message: t("sw_need_pin") }))}>
                {t("sw_continue")}
              </Button>
              <p className="text-small text-sg-ink-soft">{t("sw_no_autoloc")}</p>
            </>
          )}

          {step === 2 && (
            <>
              <ChipGrid
                label={t("sw_when")}
                options={[
                  { value: "now", label: t("sw_now") },
                  { value: "planned", label: t("sw_planned") },
                ]}
                selected={[happened ? "now" : "planned"]}
                onToggle={(v) => setHappened(v === "now")}
              />
              <TextArea
                label={t("sw_what")}
                helper={t("sw_what_ex")}
                maxLength={500}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={t("sw_what_ph")}
              />
              <Button full onClick={() => setStep(3)}>{t("sw_continue")}</Button>
              <Button variant="quiet" full onClick={() => setStep(1)}>{t("sw_back")}</Button>
            </>
          )}

          {step === 3 && (
            <>
              <ConsentReceipt
                who={t("sw_consent_who")}
                what={t("sw_consent_what2")}
                howLong={t("sw_consent_how")}
              />
              <p className="text-small text-sg-ink-soft">
                {point ? `${t("sw_pin_at")} ${point.lat.toFixed(4)}, ${point.lng.toFixed(4)} · ${happened ? t("sw_now") : t("sw_planned")}` : t("sw_need_pin")}
                {note ? ` · "${note.slice(0, 80)}${note.length > 80 ? "…" : ""}"` : ""}
              </p>
              <Button full disabled={publishing} onClick={() => setConfirmOpen(true)}>
                {publishing ? t("sw_sending") : t("sw_publish")}
              </Button>
              <Button variant="quiet" full onClick={() => setStep(2)}>{t("sw_back")}</Button>
            </>
          )}
            </>
          )}
        </div>
      </BottomSheet>

      <Dialog
        open={confirmOpen}
        title={t("sw_publish_q")}
        confirmLabel={t("sw_yes_publish")}
        onConfirm={() => { setConfirmOpen(false); void publish(); }}
        onClose={() => setConfirmOpen(false)}
      >
        {t("sw_publish_body")}
      </Dialog>
    </>
  );
}

/** Deterministic device id (#alias#tokens-on-this-browser). Mirrors server helper. */
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
  const { t } = useLanguage();
  const [state, setState] = useState<{ rows: SweepRow[]; source: DataSource; loading: boolean }>({ rows: [], source: "demo", loading: true });
  const [filter, setFilter] = useState<"all" | "active" | "planned">("all");
  const [selected, setSelected] = useState<SweepRow | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  /* Problem-report seed: which heads-up the report is about (window + first
   * line), pre-filled into the note so outreach has the context. */
  const [problemSeed, setProblemSeed] = useState<string | undefined>(undefined);
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

  /* Anonymous analytics: bare `sweep_alert_view` counter when a neighbor
   * opens a sweep detail sheet. No lat/lng, no note, no reported_by — just
   * the fact that a heads-up was viewed. Fire-and-forget. */
  const openSweep = (s: SweepRow) => {
    setSelected(s);
    try {
      logAnonymousEvent("sweep_alert_view");
    } catch {
      /* silent */
    }
  };

  /* Fresh report: empty flow. Problem report: open the REAL report flow with
   * the heads-up's window + first line seeded into the note (owner P0 —
   * the old toast-only path never filed anything). */
  const openFreshReport = () => {
    setProblemSeed(undefined);
    setReportOpen(true);
  };
  const openProblemReport = (s: SweepRow) => {
    const headline = s.note?.split(".")[0]?.trim() ?? s.window;
    setSelected(null);
    setProblemSeed(`${t("sw_problem_prefix")}${s.window} — ${headline}`);
    setReportOpen(true);
  };

  const activeCount = state.rows.filter((s) => s.status === "active" || s.status === "planned").length;

  const filtered = useMemo(() => {
    if (filter === "all") return state.rows;
    return state.rows.filter((s) => s.status === filter);
  }, [state.rows, filter]);

  const statusLabelFor = (s: SweepRow["status"]) => (s === "active" ? t("sw_active") : s === "planned" ? t("sw_planned") : t("sw_resolved"));

  return (
    <AppShell>
      <div className="flex flex-col gap-4 px-4 pt-5">
        <header className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-h1">{t("nav_sweeps")}</h1>
            <p className="mt-0.5 text-small text-sg-ink-soft">{t("sw_sub")}</p>
          </div>
        </header>

        {state.loading ? (
          <SkeletonRows rows={2} />
        ) : (
          <>
            <div className="flex flex-col gap-3">
              <SweepMapPane sweeps={state.rows} onPick={openSweep} />
              <div className="mb-1 flex items-center justify-between px-1">
                <p className="text-small text-sg-ink-soft">
                  {activeCount} {activeCount === 1 ? t("sw_count_one") : t("sw_count_many")} · {state.source === "db" ? t("sw_live") : t("sw_offline")}
                </p>
                <button ref={tabRef} type="button" onClick={refresh} className="min-h-[44px] px-1 text-small font-semibold text-sg-sky underline underline-offset-2">
                  {t("sw_refresh")}
                </button>
              </div>
            </div>

            <div className={cn("flex flex-col gap-2")}>
              <ChipGrid
                label={t("sw_filter")}
                options={[
                  { value: "all", label: t("sw_all") },
                  { value: "active", label: `${t("sw_active")} ${state.rows.filter((s) => s.status === "active").length}` },
                  { value: "planned", label: `${t("sw_planned")} ${state.rows.filter((s) => s.status === "planned").length}` },
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
            title={t("sw_empty_title")}
            body={t("sw_empty_body")}
            steps={<Button full onClick={openFreshReport}>{t("sw_report_cta")}</Button>}
          />
        ) : (
          <ul className="flex flex-col">
            {filtered.map((s) => {
              const kind = s.status === "active" ? "Active" : s.status === "planned" ? "Planned" : "Resolved";
              return (
                <ListRow key={s.id} onClick={() => openSweep(s)}>
                  <IconTile wash={s.status === "active" ? "bg-sg-clay-wash" : s.status === "planned" ? "bg-sg-gold-wash" : "bg-sg-line"}>
                    <BellMoonIcon size={20} />
                  </IconTile>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-body font-medium text-sg-ink">{s.note?.split(".")[0] ?? `${statusLabelFor(s.status)} heads-up`}</span>
                    </span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-x-1 text-small text-sg-ink-soft">
                      <StatusBadge kind={kind as "Active"}>{statusLabelFor(s.status)}</StatusBadge>
                      <span>· {s.window}</span>
                    </span>
                    <span className="mt-0.5 block text-small text-sg-ink-soft">
                      {s.reportedMinutesAgo < 60 ? `${Math.max(1, s.reportedMinutesAgo)} ${t("sw_min_ago")}` : `${Math.round(s.reportedMinutesAgo / 60)}${t("sw_hr_ago")}`} ·{" "}
                      {s.verified ? t("badge_verified") : t("badge_community")}
                    </span>
                    {s.verified ? null : (
                      <span className="mt-0.5 block text-small text-sg-ink-soft">
                        {t("badge_community_sub")}
                      </span>
                    )}
                  </span>
                </ListRow>
              );
            })}
          </ul>
        )}

        <p className="text-small text-sg-ink-soft">
          {state.source === "db"
            ? t("sw_src_live")
            : t("sw_src_off")}
        </p>
      </div>


      <ReportSheet
        open={reportOpen}
        onClose={() => setReportOpen(false)}
        seedNote={problemSeed}
        onDone={() => {
          refresh();
        }}
      />
      <SweepSheet sweep={selected} onClose={() => setSelected(null)} onReport={openProblemReport} />
    </AppShell>
  );
}

export const Route = createFileRoute("/sweeps")({ component: SweepsPage });
