/**
 * StepGuide — the plain-language "here's how it works" block.
 *
 * Owner-directed 2026-09-16: older neighbors need "calm, plain-language,
 * step-by-step instructions". Design + exact copy: Part B of
 * `/home/team/shared/peer-texting-and-plain-language-design.md`.
 *
 * What it is: a short, numbered preview of the flow the user is standing in —
 * 2–4 calm "you do this" steps in the spec's verbatim copy, then exactly one
 * "what happens next" line so nothing is a dead end. It is chrome, not a
 * wizard: the flow's real screens and their existing buttons are unchanged.
 *
 * Trauma-informed floors honored here:
 * - no urgency / countdown / "act now" wording anywhere in the guide,
 * - calm sage/sky palette, no alarm red,
 * - numbered circles are 28px on ≥48px rows (tap + read comfort),
 * - step text is the 18px/650 heading size (`text-h2`, DESIGN_SYSTEM),
 * - it can always be collapsed, so it never becomes an obstruction.
 *
 * First-visit behaviour (per the build brief): expanded on the first visit,
 * collapsed on later visits, and the collapse choice is remembered on-device
 * per flow (`sg.steps.<id>`). Nothing here is ever sent to the server.
 *
 * Dependency-light by design: react + i18n + cn only (client-safe, never
 * imports db/server code — same rule as the rest of the shared components).
 */
import { useEffect, useState } from "react";
import { Card } from "~/components/ui";
import { cn } from "~/lib/cn";
import { useLanguage } from "~/lib/i18n";

/** On-device memory key for one flow's guide (localStorage, never sent). */
export const stepGuideKey = (id: string) => `sg.steps.${id}`;

export interface StepGuideProps {
  /** Stable per-flow id — the collapse memory + the heading's DOM id. */
  id: string;
  /** The flow's step lines, already translated (t("*_stepN")), in order. */
  steps: string[];
  /** The flow's single "what happens next" line, already translated. */
  whatNext: string;
  /** Extra classes for the surrounding card. */
  className?: string;
}

export function StepGuide({ id, steps, whatNext, className }: StepGuideProps) {
  const { t } = useLanguage();
  /* SSR-safe: render expanded first (matches the server HTML), then let the
     on-device memory decide. Returning users who collapsed it get the quiet
     one-line header instead of the full list. */
  const [open, setOpen] = useState(true);

  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(stepGuideKey(id));
    } catch {
      /* private mode — the guide stays expanded, which is the safe default */
    }
    if (stored === "open" || stored === "closed") {
      setOpen(stored === "open");
      return;
    }
    /* First visit with this flow: leave it expanded, and remember to show the
       calm collapsed header next time. */
    try {
      localStorage.setItem(stepGuideKey(id), "closed");
    } catch {
      /* private mode — nothing to remember, nothing breaks */
    }
  }, [id]);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    try {
      localStorage.setItem(stepGuideKey(id), next ? "open" : "closed");
    } catch {
      /* private mode — the toggle still works for this visit */
    }
  };

  const headingId = `sg-steps-${id}`;
  return (
    <Card
      className={cn("border-sg-sage/30", className)}
    >
      <div className="flex items-start justify-between gap-2">
        <h2 id={headingId} className="text-h2 text-sg-ink">
          {t("sg_how_h")}
        </h2>
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          aria-controls={`${headingId}-body`}
          className="inline-flex min-h-[48px] shrink-0 items-center px-1 text-sg-sky underline underline-offset-2"
        >
          {open ? t("sg_steps_hide") : t("sg_steps_show")}
        </button>
      </div>
      {open ? (
        <div id={`${headingId}-body`} role="group" className="mt-2" aria-labelledby={headingId}>
          {/* Thin sage rule — the wireframe's calm progress line, decorative. */}
          <div className="h-1 w-full overflow-hidden rounded-full bg-sg-sage-wash" aria-hidden>
            <div className="h-full w-full bg-sg-sage" />
          </div>
          <ol className="mt-2 flex flex-col">
            {steps.map((step, i) => (
              <li key={`${id}-step-${i + 1}`} className="flex min-h-[48px] items-center gap-3 py-1">
                <span
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-sg-sage text-[13px] font-bold text-white"
                  aria-hidden
                >
                  {i + 1}
                </span>
                <span className="text-h2 text-sg-ink">{step}</span>
              </li>
            ))}
          </ol>
          <div className="mt-3 rounded-[12px] bg-sg-sage-wash p-3">
            <p className="text-small font-medium text-sg-sage-deep">{t("sg_what_next")}</p>
            <p className="mt-1 text-small text-sg-ink">{whatNext}</p>
          </div>
        </div>
      ) : null}
    </Card>
  );
}
