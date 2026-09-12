/**
 * SafeGround — Safety & Liability disclaimers (owner-approved 2026-09-11).
 *
 * IMMUTABLE LEGAL TEXT: the strings below are the owner's verbatim text.
 * Do NOT paraphrase, trim, reorder, or "improve" a single word. Never translate
 * them (translation errors carry liability). They are rendered from this single
 * source in every surface (join/request gates, static pages) so the legal body
 * can never drift between copies.
 *
 * UI chrome around the text (checkbox labels, reminder lines, links) is i18n'd
 * in src/lib/i18n.ts; the legal text itself stays EN-only — mirroring how
 * /terms handles the Twilio legal text.
 */

export type DisclaimerBlock =
  | { kind: "p"; text: string }
  | { kind: "h"; text: string }
  | { kind: "list"; items: string[] };

/* ── PART A — HOMETEAM HELPER SIDE (OWNER'S VERBATIM, source of truth) ── */
export const HOMETEAM_DISCLAIMER_TITLE = "HomeTeam Safety & Liability Disclaimer";

export const HOMETEAM_DISCLAIMER_BLOCKS: DisclaimerBlock[] = [
  {
    kind: "p",
    text:
      "HomeTeam helps people connect, but all meetups are voluntary and at your own risk.",
  },
  {
    kind: "p",
    text:
      "MPRCC provides communication tools only. We do not screen, verify, or guarantee the identity, safety, or behavior of any person you choose to meet through the app.",
  },
  { kind: "p", text: "By using HomeTeam, you agree to the following:" },
  { kind: "h", text: "Safety Expectations" },
  {
    kind: "list",
    items: [
      "Meet in pairs or teams. Never meet a new person alone.",
      "Choose public places. Parks, libraries, community centers, coffee shops, or other visible, populated locations.",
      "Tell someone you trust. Share your plans, location, and expected return time.",
      "Leave if you feel unsafe. You can end a meetup or communication at any time.",
      "You are responsible for your own safety.",
    ],
  },
  { kind: "h", text: "No Liability" },
  {
    kind: "p",
    text:
      "MPRCC, its staff, volunteers, and partners are not liable for any harm, injury, loss, or dispute that occurs before, during, or after a meetup arranged through HomeTeam.",
  },
  { kind: "p", text: "This includes, without limitation:" },
  {
    kind: "list",
    items: [
      "physical harm",
      "property damage",
      "theft",
      "emotional distress",
      "misconduct or criminal behavior by any user or third party",
    ],
  },
  {
    kind: "p",
    text:
      "You understand and agree that MPRCC does not supervise, control, or participate in any in-person meetings, and cannot guarantee the conduct of any user.",
  },
  { kind: "h", text: "Assumption of Risk" },
  {
    kind: "p",
    text:
      "By choosing to meet someone through HomeTeam, you voluntarily assume all risks associated with in-person interactions, including risks related to meeting strangers, traveling to a location, or sharing personal information.",
  },
  { kind: "h", text: "No Duty to Protect" },
  {
    kind: "p",
    text:
      "MPRCC does not have a legal duty to protect you from the actions of other users. You are solely responsible for deciding whether, when, and how to meet someone.",
  },
  { kind: "h", text: "Use of the App" },
  {
    kind: "p",
    text:
      "Continued use of HomeTeam constitutes your acceptance of these terms. If you do not agree, do not arrange or participate in any meetups.",
  },
];

/* ── PART B — HOMETEAM HELP-REQUEST SIDE (OWNER'S VERBATIM, source of truth) ── */
export const HELP_REQUESTS_DISCLAIMER_TITLE =
  "HomeTeam Help Requests — Safety & Liability Disclaimer";

export const HELP_REQUESTS_DISCLAIMER_BLOCKS: DisclaimerBlock[] = [
  {
    kind: "p",
    text:
      "HomeTeam lets you ask for support from people in the community, but all interactions are voluntary and at your own risk. MPRCC provides communication tools only. We do not screen, verify, or guarantee the identity, safety, or behavior of anyone who responds to your request.",
  },
  { kind: "p", text: "By using HomeTeam to ask for help, you agree to the following:" },
  { kind: "h", text: "Safety Expectations" },
  {
    kind: "list",
    items: [
      "Meet in public places. Choose parks, libraries, community centers, or other visible, populated locations.",
      "Bring someone with you when possible. A friend, peer, or team member.",
      "Share your plans. Tell someone you trust where you're going and when you expect to return.",
      "You can decline or stop at any time. You never have to meet anyone who makes you uncomfortable.",
      "Trust your instincts. If anything feels off, leave immediately.",
    ],
  },
  { kind: "h", text: "No Liability" },
  {
    kind: "p",
    text:
      "MPRCC, its staff, volunteers, and partners are not liable for any harm, injury, loss, or dispute that occurs before, during, or after any interaction or meetup arranged through HomeTeam.",
  },
  { kind: "p", text: "This includes, without limitation:" },
  {
    kind: "list",
    items: [
      "physical harm",
      "property damage or theft",
      "emotional distress",
      "misconduct, misrepresentation, or criminal behavior by any user or third party",
    ],
  },
  {
    kind: "p",
    text:
      "You understand and agree that MPRCC does not supervise, control, or participate in any in-person meetings, and cannot guarantee the conduct of any user.",
  },
  { kind: "h", text: "Assumption of Risk" },
  {
    kind: "p",
    text:
      "By requesting help or meeting someone through HomeTeam, you voluntarily assume all risks associated with in-person interactions, including risks related to meeting strangers, traveling to a location, or sharing personal information.",
  },
  { kind: "h", text: "No Duty to Protect" },
  {
    kind: "p",
    text:
      "MPRCC does not have a legal duty to protect you from the actions of other users. You are solely responsible for deciding whether, when, and how to meet someone.",
  },
  { kind: "h", text: "Use of the App" },
  {
    kind: "p",
    text:
      "Submitting a help request or continuing to use HomeTeam constitutes your acceptance of these terms. If you do not agree, do not arrange or participate in any meetups.",
  },
];

/** Render the legal blocks with the app's calm reading styles. The text is
 * EN-only by design (owner-approved; mirrors /terms). Never translate. */
export function DisclaimerText({
  blocks,
  className = "",
}: {
  blocks: DisclaimerBlock[];
  className?: string;
}) {
  return (
    <div className={`flex flex-col ${className}`}>
      {blocks.map((b, i) => {
        if (b.kind === "h") {
          return (
            <h2 key={i} className="mt-4 text-h2 text-sg-ink">
              {b.text}
            </h2>
          );
        }
        if (b.kind === "list") {
          return (
            <ul key={i} className="mt-2 flex flex-col gap-1.5">
              {b.items.map((item, j) => (
                <li key={j} className="flex gap-2 text-body leading-snug text-sg-ink-soft">
                  <span aria-hidden className="select-none text-sg-sage">
                    •
                  </span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          );
        }
        return (
          <p key={i} className="mt-2 text-body leading-snug text-sg-ink-soft">
            {b.text}
          </p>
        );
      })}
    </div>
  );
}

/** Full-disclaimer reminder-line link target labels (document titles — the
 * immutable legal names; same text in both languages). */
export const HOMETEAM_DISCLAIMER_ROUTE = "/hometeam-disclaimer";
export const HELP_REQUESTS_DISCLAIMER_ROUTE = "/help-requests-disclaimer";