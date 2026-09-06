/**
 * Home / Landing (WIREFRAMES §1) — calm front door, anonymous-first.
 * 3 safety jobs in ≤1 scroll; crisis link always visible, quiet.
 * Copy verbatim from WIREFRAMES §1 unless a privacy/trauma rule forced a change.
 */
import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell, CrisisSheet } from "~/components/shell";
import { useAuth } from "~/lib/auth";
import { Button, Card, LocationOnceButton, useToasts } from "~/components/ui";
import { getHomeStats } from "~/lib/server";
import type { DataSource } from "~/lib/server";
import { MoonBlanketIcon } from "~/lib/icons";

/* Time-aware greeting — computed client-side so SSR never mismatches (calm default first). */
function Greeting() {
  const [greeting, setGreeting] = useState("Good day.");
  useEffect(() => {
    const h = new Date().getHours();
    setGreeting(h < 12 ? "Good morning." : h < 17 ? "Good afternoon." : "Good evening.");
  }, []);
  return (
    <h1 className="text-display text-sg-ink">
      {greeting}
      <span className="mt-1 block text-body font-normal text-sg-ink-soft">
        Find rest, food, and people who care.
      </span>
    </h1>
  );
}

/* Shared hook: Home aggregates from the live database (demo fallback keeps the
 * page calm and honest if the database is unreachable — never an error wall). */
function useHomeStats(): { activeSweeps: number; resourceCount: number; openCount: number; source: DataSource; loading: boolean } {
  const [state, setState] = useState({ activeSweeps: 0, resourceCount: 0, openCount: 0, source: "demo" as DataSource, loading: true });
  useEffect(() => {
    let alive = true;
    getHomeStats()
      .then((s) => {
        if (alive) setState({ ...s, loading: false });
      })
      .catch(() => {
        if (alive) setState({ activeSweeps: 0, resourceCount: 0, openCount: 0, source: "demo", loading: false });
      });
    return () => {
      alive = false;
    };
  }, []);
  return state;
}

function HeadsUpCard() {
  const { push } = useToasts();
  const { activeSweeps, source, loading } = useHomeStats();
  if (loading) {
    return (
      <Card>
        <div className="flex items-start gap-3">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[12px] bg-sg-sky-wash text-sg-sky" aria-hidden>
            <MoonBlanketIcon size={24} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-small font-semibold text-sg-ink-soft">Heads-up near you</p>
            <div className="mt-2 h-6 w-44 animate-pulse rounded-[8px] bg-sg-line" aria-hidden />
          </div>
        </div>
      </Card>
    );
  }
  if (activeSweeps === 0) {
    return (
      <Card>
        <div className="flex items-start gap-3">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[12px] bg-sg-sky-wash text-sg-sky" aria-hidden>
            <MoonBlanketIcon size={24} />
          </span>
          <div>
            <h2 className="text-h2">Heads-up near you</h2>
            <p className="mt-1 text-body text-sg-ink-soft">No sweeps reported in your saved area. Rest easy.</p>
          </div>
        </div>
      </Card>
    );
  }
  return (
    <Card>
      <div className="flex items-start gap-3">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[12px] bg-sg-clay-wash text-sg-clay" aria-hidden>
          <MoonBlanketIcon size={24} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-small font-semibold text-sg-clay">Heads-up near you</p>
          <h2 className="text-h2">
            {activeSweeps} active sweeps reported in your saved area
          </h2>
          <p className="mt-1 text-small text-sg-ink-soft">
            {source === "db" ? "Live heads-ups from the outreach database." : "Demo data — shown in your saved area."}
          </p>
          <div className="mt-3">
            <Button variant="secondary" onClick={() => push({ kind: "info", message: "Sweep heads-ups are being built next — check back soon." })}>
              See sweeps
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}

function NearYouCard() {
  const { push } = useToasts();
  const { resourceCount, openCount, source, loading } = useHomeStats();
  return (
    <Card>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-h2">Near you</h2>
          <p className="mt-1 text-body text-sg-ink-soft">
            {loading ? "Checking the list…" : `${resourceCount} places on the list · open now: ${openCount}`}
          </p>
        </div>
      </div>
      <div className="mt-3">
        <LocationOnceButton
          onClick={() => {
            if (typeof navigator !== "undefined" && "geolocation" in navigator) {
              navigator.geolocation.getCurrentPosition(
                () => push({ kind: "success", message: "Thanks — location used once. Nothing was stored." }),
                () => push({ kind: "info", message: "Couldn't fetch location — showing nearby demo places instead. Nothing was stored." }),
                { maximumAge: 0, timeout: 8000 },
              );
            } else {
              push({ kind: "info", message: "Showing nearby demo places — nothing was stored." });
            }
          }}
        />
        <p className="mt-3 text-small text-sg-ink-soft">
          {source === "db"
            ? "Live listings — maintained and verified by outreach teams."
            : "Demo data — places are fictional for now. Live listings arrive when the database connects."}
        </p>
      </div>
    </Card>
  );
}

function SignInSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { signIn } = useAuth();
  const { push } = useToasts();
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Sign in to check in">
      <div className="absolute inset-0 bg-[rgba(30,42,50,0.6)]" onClick={onClose} aria-hidden />
      <div className="absolute inset-x-0 bottom-0 mx-auto max-w-[560px] rounded-t-[20px] bg-sg-card p-6 pb-[max(env(safe-area-inset-bottom),16px)] shadow-[0_8px_32px_rgba(30,42,50,0.18)]">
        <h2 className="text-h2">Sign in to check in</h2>
        <p className="mt-2 text-body text-sg-ink-soft">
          Check-ins are private, and they go only to people you choose — so your peers know it's you.
        </p>
        <div className="mt-5 flex flex-col gap-2">
          <Button
            full
            onClick={() => {
              signIn();
              onClose();
              push({ kind: "info", message: "You're signed in — check-in comes in the next build wave." });
            }}
          >
            Sign in
          </Button>
          <Button variant="quiet" full onClick={onClose}>
            Not now
          </Button>
        </div>
      </div>
    </div>
  );
}

function HomePage() {
  const { signedIn } = useAuth();
  const [signInOpen, setSignInOpen] = useState(false);
  const [crisisOpen, setCrisisOpen] = useState(false);

  return (
    <AppShell>
      <div className="flex flex-col gap-6 px-4 pt-6">
        <Greeting />

        <HeadsUpCard />

        <div className="flex flex-col gap-2">
          <Link to="/help" className="block">
            <Button full>Find food &amp; shelter</Button>
          </Link>
          <Link to="/sweeps" className="block">
            <Button variant="secondary" full>
              See sweep heads-ups
            </Button>
          </Link>
          {signedIn ? (
            <Link to="/checkin" className="block">
              <Button variant="secondary" full>
                Check in for tonight
              </Button>
            </Link>
          ) : (
            <button type="button" onClick={() => setSignInOpen(true)} className="w-full text-left">
              <Button variant="secondary" full disabledReason="Sign in to check in">
                Check in for tonight
              </Button>
            </button>
          )}
        </div>

        <NearYouCard />

        <footer className="flex flex-col items-start gap-2 pb-4">
          <button
            type="button"
            onClick={() => setCrisisOpen(true)}
            className="text-sg-sky underline underline-offset-2 min-h-[48px] inline-flex items-center"
          >
            Talk to someone
          </button>
          <p className="text-small text-sg-ink-soft">Demo data · Sweeps and check-ins are sample content for now.</p>
        </footer>
      </div>

      <SignInSheet open={signInOpen} onClose={() => setSignInOpen(false)} />
      <CrisisSheet open={crisisOpen} onClose={() => setCrisisOpen(false)} />
    </AppShell>
  );
}

export const Route = createFileRoute("/")({ component: HomePage });