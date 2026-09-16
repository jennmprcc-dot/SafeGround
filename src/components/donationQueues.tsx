/**
 * Pass 2 — Donation Dispatch staff queues (owner-directed 2026-09-12;
 * requester notifications + In route + outcomes 2026-09-16).
 *
 * TWO SEPARATE queues — "Offers" and "Needs" — never combined. Rendered inside
 * /outreach as separate tabs, behind the page's existing phone+PIN staff gate
 * (staffPin.ts pattern); the queue API itself re-checks the roster server-side
 * (staffGateOr403) so a non-roster phone gets the calm 403 line.
 *
 * Open first, then claimed, then In route, then completed, via an Open/All
 * filter toggle. Each row shows category, description, quantity,
 * condition/size/notes, the path details (street address for staff to act; the
 * static MPRCC porch block for mprcc_porch), contact_phone (tap-to-call), and
 * created_at.
 *
 * The row flow is an explicit three-step ladder, never a text note:
 *   (1) Claim   — "I'm on it" (server sets claimed_by from the gated caller and
 *                 pings the requester, naming the claimer: "Jenn is bringing
 *                 your tent.")
 *   (2) In route — a real state + button; pings "MPRCC staff is on the way
 *                 with your {item}."
 *   (3) Outcome — two buttons: Delivered (row leaves the active queue) or Peer
 *                 not at spot (row STAYS ACTIVE, item held, calm reschedule
 *                 ping). The note is optional and lands on the row with who/when.
 * No auto-matching — staff still coordinate by phone. No delete path exists.
 */
import { useCallback, useEffect, useState } from "react";
import {
  DONATION_API,
  DONATION_OUTCOME,
  MPRCC_PORCH,
  type DonationOutcome,
  type DonationStatus,
} from "~/lib/donation";
import { formatPhone } from "~/lib/alertIdentity";
import { Button, Card, EmptyState, SkeletonRows, StatusBadge } from "~/components/ui";
import { CheckCircleIcon, HandsIcon } from "~/lib/icons";
import { SubmitConfirm, type SubmitConfirmState } from "~/components/submitConfirm";
import { useLanguage } from "~/lib/i18n";

export type DonationQueueKind = "offers" | "requests";

interface OfferRow {
  id: string;
  path: string;
  itemDescription: string;
  category: string;
  conditionNote: string | null;
  quantity: string | null;
  contactPhone: string;
  address: { street: string | null; city: string | null; zip: string | null };
  approachNotes: string | null;
  pickupTimeWindow: string | null;
  photoB64: string | null;
  status: DonationStatus;
  claimedBy: string | null;
  claimedAt: string | null;
  routeStartedAt: string | null;
  completedAt: string | null;
  outcome: string | null;
  outcomeAt: string | null;
  outcomeByPhone: string | null;
  attempts: number;
  outcomeNote: string | null;
  createdAt: string;
  updatedAt: string;
}

interface RequestRow {
  id: string;
  item: string;
  category: string;
  quantity: string | null;
  notes: string | null;
  size: string | null;
  pickupOrDelivery: string;
  contactPhone: string;
  status: DonationStatus;
  claimedBy: string | null;
  claimedAt: string | null;
  routeStartedAt: string | null;
  completedAt: string | null;
  outcome: string | null;
  outcomeAt: string | null;
  outcomeByPhone: string | null;
  attempts: number;
  outcomeNote: string | null;
  createdAt: string;
  updatedAt: string;
}

type LoadState =
  | { kind: "loading" }
  | { kind: "forbidden" }
  | { kind: "unavailable"; message: string }
  | { kind: "ready"; rows: Array<OfferRow | RequestRow> };

function timeLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function statusBadge(status: DonationStatus): "Active" | "Planned" | "Resolved" {
  if (status === "claimed" || status === "in_route") return "Planned";
  if (status === "completed") return "Resolved";
  return "Active";
}

/** MPRCC porch block — static constant, shown verbatim for mprcc_porch rows. */
function PorchBlock() {
  return (
    <span className="mt-1 block rounded-[10px] bg-sg-paper px-3 py-2 text-small text-sg-ink-soft">
      {MPRCC_PORCH.address} — {MPRCC_PORCH.hours}
      <span className="mt-0.5 block text-sg-ink">“{MPRCC_PORCH.dropInstruction}”</span>
    </span>
  );
}

interface RowActionsProps {
  id: string;
  status: DonationStatus;
  acting: boolean;
  panelFor: string | null;
  outcome: string;
  onOutcome: (v: string) => void;
  onStartOutcome: (id: string) => void;
  onCancelOutcome: () => void;
  onClaim: (id: string) => void;
  onInRoute: (id: string) => void;
  onRecord: (id: string, outcome: DonationOutcome) => void;
}

/** The card-level handlers (id/status are card-owned, injected at render). */
type RowActionHandlers = Omit<RowActionsProps, "id" | "status">;

/** Claim → In route → outcome, shared by offer + request cards. */
function RowActions(props: RowActionsProps) {
  const { t } = useLanguage();
  const { id, status, acting, panelFor, outcome, onOutcome, onStartOutcome, onCancelOutcome, onClaim, onInRoute, onRecord } = props;
  if (status === "completed") return null;
  const panelOpen = panelFor === id;
  const canRecord = status === "claimed" || status === "in_route";
  return (
    <div className="mt-3 flex flex-col gap-2">
      {status === "open" ? (
        <Button variant="secondary" full disabled={acting} onClick={() => onClaim(id)}>
          {t("dn_q_claim")}
        </Button>
      ) : null}
      {status === "claimed" ? (
        <Button variant="secondary" full disabled={acting} onClick={() => onInRoute(id)}>
          {t("dsp_mark_in_route")}
        </Button>
      ) : null}
      {panelOpen ? (
        <div className="flex flex-col gap-2 rounded-[12px] border border-sg-line bg-sg-paper p-3">
          <p className="text-btn font-medium">{t("dsp_outcome_open")}</p>
          <label className="flex flex-col gap-1.5">
            <span className="text-small text-sg-ink-soft">{t("dsp_outcome_note")}</span>
            <input
              value={outcome}
              onChange={(e) => onOutcome(e.target.value)}
              placeholder={t("dsp_outcome_note_ph")}
              maxLength={500}
              className="min-h-[52px] w-full rounded-[12px] border-2 border-sg-line bg-sg-card px-4 text-body text-sg-ink outline-none focus:border-sg-ink"
            />
          </label>
          <Button full disabled={acting} onClick={() => onRecord(id, DONATION_OUTCOME.DELIVERED)}>
            {t("dsp_delivered")}
          </Button>
          <Button
            variant="secondary"
            full
            disabled={acting}
            onClick={() => onRecord(id, DONATION_OUTCOME.PEER_NOT_AT_SPOT)}
          >
            {t("dsp_not_at_spot")}
          </Button>
          <Button variant="quiet" full disabled={acting} onClick={onCancelOutcome}>
            {t("dn_q_cancel")}
          </Button>
        </div>
      ) : canRecord ? (
        <Button variant="quiet" full disabled={acting} onClick={() => onStartOutcome(id)}>
          {t("dsp_outcome_open")}…
        </Button>
      ) : null}
    </div>
  );
}

function OfferCard({
  row,
  callerPhone,
  ...actions
}: { row: OfferRow; callerPhone: string } & RowActionHandlers) {
  const { t } = useLanguage();
  const pathLabel =
    row.path === "porch_drop" ? t("dn_path_porch") : row.path === "scheduled_pickup" ? t("dn_path_pickup") : t("dn_path_mprcc");
  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-small font-medium text-sg-ink-soft">{pathLabel} · {timeLabel(row.createdAt)}</p>
          <h3 className="mt-0.5 text-body font-medium text-sg-ink">{row.itemDescription}</h3>
          <p className="mt-0.5 text-small text-sg-ink-soft">{row.category}{row.quantity ? ` — Qty: ${row.quantity}` : ""}</p>
          {row.conditionNote ? <p className="mt-0.5 text-small text-sg-ink-soft">Condition: {row.conditionNote}</p> : null}
          {row.approachNotes ? <p className="mt-0.5 text-small text-sg-ink-soft">Approach: {row.approachNotes}</p> : null}
          {row.pickupTimeWindow ? <p className="mt-0.5 text-small text-sg-ink-soft">Pickup window: {row.pickupTimeWindow}</p> : null}
        </div>
        <StatusBadge kind={statusBadge(row.status)}>{statusLabel(row.status, t)}</StatusBadge>
      </div>

      {/* Path details — address for staff to act; porch block for mprcc_porch */}
      {row.path === "mprcc_porch" ? (
        <PorchBlock />
      ) : (
        <p className="mt-2 rounded-[10px] bg-sg-paper px-3 py-2 text-small text-sg-ink-soft">
          {[row.address.street, row.address.city, row.address.zip].filter(Boolean).join(", ")}
        </p>
      )}

      {row.photoB64 ? (
        <img
          src={`data:image/jpeg;base64,${row.photoB64}`}
          alt={t("dn_photo_preview")}
          className="mt-2 h-28 w-28 rounded-[12px] border border-sg-line object-cover"
        />
      ) : null}

      <p className="mt-2 text-small text-sg-ink-soft">
        <a href={`tel:${row.contactPhone}`} className="text-sg-sky underline underline-offset-2">
          {formatPhone(row.contactPhone)}
        </a>
        {row.claimedBy
          ? row.claimedBy === callerPhone
            ? ` · ${t("dn_q_claimed_you")}`
            : ` · ${t("dn_q_claimed").replace("{phone}", formatPhone(row.claimedBy))}`
          : ""}
      </p>
      <RowProgress row={row} />
      <RowActions {...actions} status={row.status} id={row.id} />
    </Card>
  );
}

function RequestCard({
  row,
  callerPhone,
  ...actions
}: { row: RequestRow; callerPhone: string } & RowActionHandlers) {
  const { t } = useLanguage();
  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-small font-medium text-sg-ink-soft">{row.pickupOrDelivery} · {timeLabel(row.createdAt)}</p>
          <h3 className="mt-0.5 text-body font-medium text-sg-ink">{row.item}</h3>
          <p className="mt-0.5 text-small text-sg-ink-soft">{row.category}{row.quantity ? ` — Qty: ${row.quantity}` : ""}</p>
          {row.size ? <p className="mt-0.5 text-small text-sg-ink-soft">Size: {row.size}</p> : null}
          {row.notes ? <p className="mt-0.5 text-small text-sg-ink-soft">{row.notes}</p> : null}
        </div>
        <StatusBadge kind={statusBadge(row.status)}>{statusLabel(row.status, t)}</StatusBadge>
      </div>

      <p className="mt-2 text-small text-sg-ink-soft">
        <a href={`tel:${row.contactPhone}`} className="text-sg-sky underline underline-offset-2">
          {formatPhone(row.contactPhone)}
        </a>
        {row.claimedBy
          ? row.claimedBy === callerPhone
            ? ` · ${t("dn_q_claimed_you")}`
            : ` · ${t("dn_q_claimed").replace("{phone}", formatPhone(row.claimedBy))}`
          : ""}
      </p>
      <RowProgress row={row} />
      <RowActions {...actions} status={row.status} id={row.id} />
    </Card>
  );
}

/** The honest trail under a card: In route timestamp, held-for-retry state and
 * the recorded outcome (who/what/when all live on the row server-side). */
function RowProgress({
  row,
}: {
  row: {
    status: DonationStatus;
    routeStartedAt: string | null;
    outcome: string | null;
    outcomeNote: string | null;
    attempts: number;
  };
}) {
  const { t } = useLanguage();
  return (
    <>
      {row.status === "in_route" && row.routeStartedAt ? (
        <p className="mt-1 text-small text-sg-ink-soft">
          {t("dsp_in_route_at").replace("{time}", timeLabel(row.routeStartedAt))}
        </p>
      ) : null}
      {row.status !== "completed" && row.outcome === DONATION_OUTCOME.PEER_NOT_AT_SPOT ? (
        <span className="mt-1 block rounded-[10px] bg-sg-sage-wash px-3 py-2 text-small text-sg-sage-deep">
          {t("dsp_held_note")}
          {row.attempts > 0 ? ` ${t("dsp_attempts_note").replace("{n}", String(row.attempts))}` : ""}
        </span>
      ) : null}
      {row.status === "completed" ? (
        <p className="mt-1 text-small text-sg-ink-soft">
          {row.outcome === DONATION_OUTCOME.DELIVERED ? t("dsp_delivered") : t("dn_q_complete")}
          {row.outcomeNote ? ` — ${row.outcomeNote}` : ""}
        </p>
      ) : null}
    </>
  );
}

/** Calm status label — Open / Claimed / In route / Completed. */
function statusLabel(status: DonationStatus, t: (k: "dsp_status_in_route") => string): string {
  if (status === "open") return "Open";
  if (status === "claimed") return "Claimed";
  if (status === "in_route") return t("dsp_status_in_route");
  return "Completed";
}

export function DonationQueueSection({ queue, phone }: { queue: DonationQueueKind; phone: string }) {
  const { t } = useLanguage();
  const [onlyOpen, setOnlyOpen] = useState(true);
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [acting, setActing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionConfirmed, setActionConfirmed] = useState<SubmitConfirmState | null>(null);
  const [panelFor, setPanelFor] = useState<string | null>(null);
  const [outcome, setOutcome] = useState("");

  const load = useCallback(async (p: string, openOnly: boolean) => {
    // Returning the SAME object bails React out of the re-render. Without this
    // a refetch that re-enters "loading" re-rendered → new callback/prop
    // identities → effect re-ran → fetch again: the owner-reported 2026-09-16
    // dashboard flicker (measured ~6,300 API calls in 4s). A real state change
    // (ready → loading, e.g. after a claim or Try again) still shows the
    // skeleton exactly as before.
    setState((prev) => (prev.kind === "loading" ? prev : { kind: "loading" }));
    try {
      const base = queue === "offers" ? DONATION_API.offersQueue : DONATION_API.requestsQueue;
      const res = await fetch(`${base}?phone=${encodeURIComponent(p)}&status=${openOnly ? "open" : "all"}`);
      const data = (await res.json().catch(() => null)) as {
        ok?: boolean;
        error?: string;
        offers?: OfferRow[];
        requests?: RequestRow[];
      } | null;
      if (res.status === 403) {
        setState({ kind: "forbidden" });
      } else if (res.ok && data?.ok) {
        setState({ kind: "ready", rows: (queue === "offers" ? data.offers : data.requests) ?? [] });
      } else {
        setState({ kind: "unavailable", message: data?.error ?? t("dn_q_load_err") });
      }
    } catch {
      setState({ kind: "unavailable", message: t("dn_q_load_err") });
    }
  }, [queue, t]);

  useEffect(() => {
    if (phone.length >= 10) void load(phone, onlyOpen);
    else setState((prev) => (prev.kind === "loading" ? prev : { kind: "loading" }));
  }, [phone, onlyOpen, load]);

  const act = async (
    id: string,
    action: "claim" | "in_route" | "delivered" | "peer_not_at_spot",
  ) => {
    setActing(true);
    setActionError(null);
    try {
      const url =
        action === "claim"
          ? DONATION_API.claim
          : action === "in_route"
            ? DONATION_API.inRoute
            : DONATION_API.complete;
      const payload =
        action === "claim" || action === "in_route"
          ? { queue, id, staffPhone: phone }
          : { queue, id, staffPhone: phone, outcomeNote: outcome.trim(), outcome: action };
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (res.ok && data?.ok) {
        const line =
          action === "claim"
            ? t("dn_q_saved")
            : action === "in_route"
              ? t("dsp_saved_in_route")
              : action === "delivered"
                ? t("dsp_saved_delivered")
                : t("dsp_saved_held");
        setActionConfirmed({ saved: true, kind: "saved", line });
        setPanelFor(null);
        setOutcome("");
        await load(phone, onlyOpen);
      } else {
        setActionError(data?.error ?? t("dn_q_err"));
      }
    } catch {
      setActionError(t("dn_q_err"));
    } finally {
      setActing(false);
    }
  };

  const actionsFor: RowActionHandlers = {
    acting,
    panelFor,
    outcome,
    onOutcome: setOutcome,
    onStartOutcome: (id) => { setPanelFor(id); setOutcome(""); },
    onCancelOutcome: () => { setPanelFor(null); setOutcome(""); },
    onClaim: (id) => void act(id, "claim"),
    onInRoute: (id) => void act(id, "in_route"),
    onRecord: (id, o) => void act(id, o),
  };

  const title = queue === "offers" ? t("dn_q_offer_title") : t("dn_q_request_title");
  const sub = queue === "offers" ? t("dn_q_offer_sub") : t("dn_q_request_sub");

  return (
    <section aria-label={title} className="flex flex-col gap-3">
      <div>
        <h2 className="text-h2">{title}</h2>
        <p className="mt-0.5 text-small text-sg-ink-soft">{sub}</p>
      </div>

      <div className="flex gap-2" role="tablist" aria-label={t("dn_q_filter")}>
        <button
          type="button"
          role="tab"
          aria-selected={onlyOpen}
          onClick={() => setOnlyOpen(true)}
          className={
            onlyOpen
              ? "min-h-[44px] flex-1 rounded-[12px] border-2 border-sg-sage bg-sg-sage-wash px-3 text-btn font-medium text-sg-sage-deep"
              : "min-h-[44px] flex-1 rounded-[12px] border-2 border-sg-line bg-sg-card px-3 text-btn text-sg-ink"
          }
        >
          {t("dn_q_open")}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={!onlyOpen}
          onClick={() => setOnlyOpen(false)}
          className={
            !onlyOpen
              ? "min-h-[44px] flex-1 rounded-[12px] border-2 border-sg-sage bg-sg-sage-wash px-3 text-btn font-medium text-sg-sage-deep"
              : "min-h-[44px] flex-1 rounded-[12px] border-2 border-sg-line bg-sg-card px-3 text-btn text-sg-ink"
          }
        >
          {t("dn_q_all")}
        </button>
      </div>

      <p className="text-small text-sg-ink-soft">{t("dn_staff_action")}</p>
      <p className="text-small text-sg-ink-soft">{t("dsp_ping_note")}</p>

      {actionError ? (
        <p className="rounded-[12px] bg-sg-clay-wash px-3 py-2 text-small text-sg-clay" role="alert">
          {actionError}
        </p>
      ) : null}
      {actionConfirmed ? (
        <div className="flex flex-col gap-2">
          <SubmitConfirm state={actionConfirmed} />
        </div>
      ) : null}

      {state.kind === "loading" ? (
        <SkeletonRows rows={3} />
      ) : state.kind === "forbidden" ? (
        <EmptyState
          icon={<HandsIcon size={28} />}
          title={t("dn_q_403")}
          body={t("dn_q_403_sub")}
        />
      ) : state.kind === "unavailable" ? (
        <EmptyState
          icon={<HandsIcon size={28} />}
          title={t("dn_q_unavailable")}
          body={state.message}
          steps={<Button variant="secondary" full onClick={() => void load(phone, onlyOpen)}>Try again</Button>}
        />
      ) : state.rows.length === 0 ? (
        <EmptyState
          icon={<CheckCircleIcon size={28} />}
          title={queue === "offers" ? t("dn_q_empty_offer") : t("dn_q_empty_request")}
          body={t("dn_q_empty_sub")}
        />
      ) : (
        <div className="flex flex-col gap-3">
          {queue === "offers"
            ? (state.rows as OfferRow[]).map((row) => (
                <OfferCard key={row.id} row={row} callerPhone={phone} {...actionsFor} />
              ))
            : (state.rows as RequestRow[]).map((row) => (
                <RequestCard key={row.id} row={row} callerPhone={phone} {...actionsFor} />
              ))}
        </div>
      )}
    </section>
  );
}
