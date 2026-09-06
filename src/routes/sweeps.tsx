/**
 * Sweep Alerts — Build B. Placeholder page keeps the bottom-nav tab calm
 * and reachable with the demo count. Full map/list/report wave lands next.
 */
import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "~/components/shell";
import { Button, Card, EmptyState } from "~/components/ui";
import { DEMO_SWEEPS, ACTIVE_SWEEP_COUNT } from "~/lib/data";
import { BellMoonIcon } from "~/lib/icons";

function SweepsPage() {
  const active = DEMO_SWEEPS.filter((s) => s.status === "active" || s.status === "planned").length;
  return (
    <AppShell>
      <div className="flex flex-col gap-4 px-4 pt-5">
        <header>
          <h1 className="text-h1">Sweeps</h1>
          <p className="mt-0.5 text-small text-sg-ink-soft">Heads-ups from neighbors, kept calm.</p>
        </header>

        <Card>
          <div className="flex items-start gap-3">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[12px] bg-sg-clay-wash text-sg-clay" aria-hidden>
              <BellMoonIcon size={24} />
            </span>
            <div>
              <p className="text-small font-semibold text-sg-clay">Heads-up · demo</p>
              <h2 className="text-h2">{active} sweep heads-ups in your area</h2>
              <p className="mt-1 text-body text-sg-ink-soft">
                Sweep map and reports are the next build wave — what's shown here is sample data so you can see the shape.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button variant="secondary" onClick={() => undefined} disabledReason="Report flow comes with the next wave">
                  Report what you see
                </Button>
                <Button variant="quiet" onClick={() => undefined}>
                  See all heads-ups
                </Button>
              </div>
            </div>
          </div>
        </Card>

        <EmptyState
          icon={<BellMoonIcon size={28} />}
          title="Rest easy — the full map is on its way"
          body="The sweep map, report form, and verification badges all land in the next build wave. Nothing here is live."
          steps={<Button onClick={() => undefined} disabledReason="Coming in the next wave">Report what you see</Button>}
        />

        <p className="text-small text-sg-ink-soft">
          Demo data (active count {ACTIVE_SWEEP_COUNT}) · real listings arrive when the database connects.
        </p>
      </div>
    </AppShell>
  );
}

export const Route = createFileRoute("/sweeps")({ component: SweepsPage });