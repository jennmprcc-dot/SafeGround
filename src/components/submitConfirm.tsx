/**
 * SubmitConfirm — persistent on-screen confirmation for submit paths
 * (owner-directed 2026-09-07: every submit must END on a confirmation that it
 * SAVED and whether the team was notified — no more short-lived toasts as the
 * only signal). Honest copy driven by the server result:
 *  - saved + team notified → "Saved — the team has been notified."
 *  - saved, no team push    → "Saved — we'll follow up." / "Saved to the queue."
 *  - draft/offline          → "Saved on this phone — will sync when connected."
 * Renders as a persistent sage card that STAYS until the next action starts.
 */
import { CheckCircleIcon } from "~/lib/icons";

export type SubmitConfirmState = {
  /** The write reached the server. */
  saved: boolean;
  /** true = team push went out; false/null = queued for the team, no push. */
  teamNotified?: boolean | null;
  /** Custom honest line (overrides the auto copy). */
  line?: string;
  kind?: "saved" | "draft";
};

export function SubmitConfirm({ state, className = "" }: { state: SubmitConfirmState; className?: string }) {
  const line =
    state.line ??
    (state.kind === "draft"
      ? "Saved on this phone — will sync when the connection returns."
      : state.teamNotified
        ? "Saved — the team has been notified."
        : "Saved to the queue — we'll follow up.");
  const draft = state.kind === "draft";
  return (
    <div
      role="status"
      className={`flex items-start gap-3 rounded-[12px] border px-3 py-3 ${
        draft ? "border-sg-gold/40 bg-sg-gold-wash/60" : "border-sg-sage bg-sg-sage-wash"
      } ${className}`}
    >
      <span aria-hidden className={draft ? "text-sg-gold" : "text-sg-sage"}>
        <CheckCircleIcon size={20} />
      </span>
      <p className={`text-small font-medium ${draft ? "text-sg-ink" : "text-sg-sage-deep"}`}>{line}</p>
    </div>
  );
}