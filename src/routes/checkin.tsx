/**
 * Safe Sleeping Check-Ins — Build B. Placeholder keeps the tab reachable;
 * the consent-first check-in loop (confirm sheet + peers + fuzzed map) lands
 * in the next build wave per the delegation's Build B scope.
 */
import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "~/components/shell";
import { Button, Card, ConsentReceipt, EmptyState, useToasts } from "~/components/ui";
import { useAuth } from "~/lib/auth";
import { MoonBlanketIcon } from "~/lib/icons";

function CheckInPage() {
  const { signedIn } = useAuth();
  const { push } = useToasts();

  return (
    <AppShell>
      <div className="flex flex-col gap-4 px-4 pt-5">
        <header>
          <h1 className="text-h1">Check in</h1>
          <p className="mt-0.5 text-small text-sg-ink-soft">Check in when you're ready — no rush.</p>
        </header>

        {!signedIn ? (
          <EmptyState
            icon={<MoonBlanketIcon size={28} />}
            title="Check-ins are private by design"
            body="Sign in so your check-in goes only to people you choose — nobody else can see it."
            steps={
              <Button full onClick={() => push({ kind: "info", message: "Sign-in is a demo flag for now — full check-in lands next wave." })}>
                Sign in
              </Button>
            }
          />
        ) : (
          <Card>
            <h2 className="text-h2">Sharing with: no one yet</h2>
            <p className="mt-1 text-body text-sg-ink-soft">
              The full check-in loop — trusted peers, consent sheet, fuzzed find-my-friend map — is the next build wave.
            </p>
            <div className="mt-4">
              <Button full onClick={() => push({ kind: "info", message: "Check-in flow lands in the next wave — coming soon." })}>
                Check in &amp; share with peers
              </Button>
            </div>
          </Card>
        )}

        <ConsentReceipt
          who="Only your chosen peers"
          what="Approximate area (~150m) + time"
          howLong="24 hours, then it disappears"
          stopLabel="Pause sharing"
          onStop={() => push({ kind: "info", message: "Pause arrives with the check-in flow next wave." })}
        />

        <p className="text-small text-sg-ink-soft">Demo · no location is ever collected here.</p>
      </div>
    </AppShell>
  );
}

export const Route = createFileRoute("/checkin")({ component: CheckInPage });