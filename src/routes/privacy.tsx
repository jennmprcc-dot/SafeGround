/**
 * About & privacy (R-P2, R-P6, R-P11 reflection, plus the [?] route).
 * Plain-language: what we never do (no background location, no surveillance),
 * consent receipts everywhere, and how to stop sharing.
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell } from "~/components/shell";
import { Card } from "~/components/ui";

const promises = [
  {
    title: "No background location, ever",
    body: "SafeGround never watches where you are. Location is used only when you tap “Use my location once” — a single read for that one lookup, nothing stored.",
  },
  {
    title: "Sharing is always your choice",
    body: "Every share shows you who sees it, what they see, and how long it lasts — before the tap. You can stop sharing or remove a peer anytime, instantly.",
  },
  {
    title: "Read without fear",
    body: "Sweep heads-ups, resources, and this page are open to everyone — no account, no permission prompts.",
  },
  {
    title: "Peers see approximate, never exact",
    body: "If you share a check-in, trusted peers see a ~150m “approximate area,” never your exact spot. It disappears after 24 hours.",
  },
  {
    title: "No sirens, no surveillance",
    body: "This app uses calm words and gentle colors on purpose. No counts that feel like watching, no alarm styles, no automatic notifications to authorities.",
  },
  {
    title: "Anonymous counts, never tracked",
    body: "Analytics are anonymous and zero-PII: we never log your phone, location, or device identifiers.",
  },
];

function PrivacyPage() {
  return (
    <AppShell>
      <div className="flex flex-col gap-4 px-4 pt-5 pb-6">
        <Link to="/" className="text-small text-sg-sky underline underline-offset-2 inline-flex min-h-[44px] items-center">
          Back to Home
        </Link>
        <header>
          <h1 className="text-h1">About &amp; privacy</h1>
          <p className="mt-0.5 text-body text-sg-ink-soft">
            SafeGround is a calm safety companion — not a surveillance tool. This is what we promise.
          </p>
        </header>

        <div className="flex flex-col gap-3">
          {promises.map((p) => (
            <Card key={p.title}>
              <h2 className="text-h2">{p.title}</h2>
              <p className="mt-1.5 text-body text-sg-ink-soft">{p.body}</p>
            </Card>
          ))}
        </div>

        <Card>
          <h2 className="text-h2">Where the data lives</h2>
          <p className="mt-1.5 text-body text-sg-ink-soft">
            This preview runs on demo data. The real listings and heads-ups come from a database with row-level
            security — every row is private to its owner, peers see only the fuzzed fields they're allowed to,
            and resources/sweeps are public for anyone to read.
          </p>
        </Card>

        <p className="text-small text-sg-ink-soft">
          Questions or corrections? Suggest them through the app — outreach will pick them up.
        </p>
      </div>
    </AppShell>
  );
}

export const Route = createFileRoute("/privacy")({ component: PrivacyPage });