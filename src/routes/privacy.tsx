/**
 * Privacy Policy — plain language, mirrors the terms page layout.
 * Effective 2026-09-09 (Twilio toll-free verification). Honest about what
 * the app actually does: SMS consent + reply-STOP, after-hours off by
 * default, no background location tracking, anonymous analytics only.
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell } from "~/components/shell";
import { Card } from "~/components/ui";
const sections: Array<{ title: string; body: string }> = [
  {
    title: "SMS & your phone number",
    body: "We collect your phone number to send SMS alerts, supply updates, and verification codes. We do not sell or share phone numbers. Message and data rates may apply.",
  },
  {
    title: "Only what you opted into",
    body: "Phone numbers are used only for the text messaging you opted into — never for anything else and never shared or sold. When you opt in, your consent is stored with your number. You can unsubscribe at any time by replying STOP to any message; your opt-out is honored and stored.",
  },
  {
    title: "After-hours messages are off by default",
    body: "Texts are sent during business hours (8am–6pm, Mon–Fri) unless you have separately consented to after-hours messages, which is off by default.",
  },
  {
    title: "Location is shared only by you, in the moment",
    body: "There is no background location tracking, ever. Location is shared only when you choose to share it: a check-in with a trusted peer shows your approximate area (~150 m) only while it is active, and alerts let you pick no location, a fuzzed location, or exact location at the moment you send. Exact location is visible only to the people you notified and MPRCC's outreach team, and it expires with the alert.",
  },
  {
    title: "Analytics are anonymous",
    body: "Analytics are anonymous aggregates only — no names, phone numbers, precise GPS, or IP addresses are collected or logged. We count things like resource searches and support requests to write impact reports for grants.",
  },
  {
    title: "Data is used to coordinate support",
    body: "The information you share is used only to coordinate the support you asked for — resources, supplies, alerts, and peer support — and for MPRCC's internal reporting. It is never sold or used for anything else.",
  },
  {
    title: "Not for 911 emergencies",
    body: "Texting and notifications are not a substitute for calling 911 in an emergency. If you or someone else is in immediate danger, call 911 directly.",
  },
  {
    title: "Who we are",
    body: "SafeGround is built and run by Marin Peer Resource Community Collective (MPRCC), a community mutual-aid organization serving Marin County. Questions about this policy can be raised through the app's peer-support request.",
  },
];
function PrivacyPage() {
  return (
    <AppShell>
      <div className="flex flex-col gap-4 px-4 pt-5 pb-6">
        <Link to="/terms" className="text-small text-sg-sky underline underline-offset-2 inline-flex min-h-[44px] items-center">
          ← Terms of Service
        </Link>
        <header>
          <h1 className="text-h1">Privacy Policy</h1>
          <p className="mt-0.5 text-body text-sg-ink-soft">
            Plain-language privacy for SafeGround — what we collect, what we never do.
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
          SafeGround — a project of Marin Peer Resource Community Collective (MPRCC). Effective September 9, 2026.{" "}
          <Link to="/terms" className="text-sg-sky underline underline-offset-2">
            Read the Terms of Service.
          </Link>
        </p>
      </div>
    </AppShell>
  );
}
export const Route = createFileRoute("/privacy")({ component: PrivacyPage });