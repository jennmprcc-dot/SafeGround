/**
 * Terms of Service — plain language. Mirrors the privacy page layout.
 * Covers: mutual-aid scope (not emergency/911), SMS terms (consent, STOP/HELP,
 * frequency, rates), opt-in-only messaging, no-warranty, changes, contact.
 * Added 2026-09-08 for Twilio toll-free verification.
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell } from "~/components/shell";
import { Card } from "~/components/ui";

const sections: Array<{ title: string; body: string }> = [
  {
    title: "What SafeGround is",
    body: "SafeGround is a mutual-aid tool from MPRCC that helps neighbors in Marin County find resources, stay informed about sweeps, connect with trusted peers, and request support. It is not a medical, legal, or emergency service.",
  },
  {
    title: "Not for 911 emergencies",
    body: "SafeGround never automatically contacts 911 or any agency. If you or someone else is in immediate danger, call 911 directly. Alerts shared here go only to the people you choose and MPRCC's outreach team.",
  },
  {
    title: "Your information & consent",
    body: "We only contact you by text or notification when you opt in. Consent is stored when you enter your number and tick the box — never assumed. You can change your mind anytime, and your data is only used to coordinate care you asked for. Everything shared ('find my friend', alerts, location) is shared by you, in the moment, and never tracked in the background.",
  },
  {
    title: "Text (SMS) terms",
    body: "By opting in to texts you agree to receive messages from MPRCC about support, supplies, and safety coordination. Message frequency varies: typically a few per week, and emergency alerts as needed. Message and data rates may apply per your carrier. Help is available: reply HELP for assistance, or STOP at any time to cancel — after STOP we won't text you again. Texting is not a substitute for calling 911 in an emergency.",
  },
  {
    title: "No guarantee",
    body: "MPRCC and its volunteers work in good faith to keep information current and respond to requests, but we cannot guarantee that listed resources are open, that messages will arrive, or that any specific outcome will happen. Use the tool with care and judgment.",
  },
  {
    title: "Changes & contact",
    body: "These terms may be updated as the community grows; changes take effect when posted here. Questions or concerns can be raised through MPRCC's peer team — reach out through the app's peer-support request and a person (not a bot) will respond.",
  },
];

function TermsPage() {
  return (
    <AppShell>
      <div className="flex flex-col gap-4 px-4 pt-5 pb-6">
        <Link to="/privacy" className="text-small text-sg-sky underline underline-offset-2 inline-flex min-h-[44px] items-center">
          ← Privacy
        </Link>
        <header>
          <h1 className="text-h1">Terms of Service</h1>
          <p className="mt-0.5 text-body text-sg-ink-soft">
            Plain-language terms for using SafeGround — no fine print.
          </p>
        </header>
        <div className="flex flex-col gap-3">
          {sections.map((s) => (
            <Card key={s.title}>
              <h2 className="text-h2">{s.title}</h2>
              <p className="mt-1.5 text-body text-sg-ink-soft">{s.body}</p>
            </Card>
          ))}
        </div>
        <p className="text-small text-sg-ink-soft">
          SafeGround — a project of MPRCC. Last updated September 8, 2026.
        </p>
      </div>
    </AppShell>
  );
}

export const Route = createFileRoute("/terms")({ component: TermsPage });