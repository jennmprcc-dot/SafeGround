/**
 * Group notice composer + confirm (NOTICE-1 + NOTICE-2, spec §2.2) — admin
 * only. Route: /outreach/directory/notice?phone=…
 *
 * Step 1 (composer): audience radio (none pre-selected), title ≤80 + body
 * ≤500 with live counters, info card with the LIVE eligibility estimate from
 * sg_notice_eligible ("Will reach ~N opted-in members right now (M skipped
 * — after hours)"), draft autosaved locally, Review before sending.
 * Step 2 (confirm): verbatim preview + audience receipt + exact-count
 * [Send to N people]. Success view with transparent counts. RPC-empty
 * failure: "That would reach no one right now…". Calm sentence case
 * throughout; links stay plain text (never tappable — rendered as text).
 *
 * Non-admin callers (staff_limited, non-roster) get the calm 404-equivalent
 * "This space is for the outreach team." — the page never reveals that
 * messaging exists.
 */
import { useCallback, useEffect, useState } from "react";
import { createFileRoute, Link, useSearch } from "@tanstack/react-router";
import { AppShell } from "~/components/shell";
import { Button, Card, EmptyState, SkeletonRows } from "~/components/ui";
import { getAlertIdentity, phoneLooksOk } from "~/lib/alertIdentity";
import { HandsIcon } from "~/lib/icons";

type Audience = "hometeam" | "neighbors" | "both";

const CALM_404 = "This space is for the outreach team.";
const DRAFT_KEY = "sg.notice.draft";

interface Elig {
  ok: boolean;
  audience?: Audience;
  eligible?: number;
  skippedAfterHours?: number;
  error?: string;
}

interface SendResult {
  ok: boolean;
  noticeId?: string;
  eligible?: number;
  sent?: number;
  skippedAfterHours?: number;
  skippedNoToken?: number;
  error?: string;
}

function audienceLabel(a: Audience): string {
  if (a === "hometeam") return "HomeTeam supporters";
  if (a === "neighbors") return "Neighbors opted in";
  return "Both";
}

function NoticeComposerPage() {
  const search = useSearch({ strict: false }) as { phone?: string };
  const [identity] = useState(() => getAlertIdentity());
  const [phoneInput, setPhoneInput] = useState(
    typeof search.phone === "string" && search.phone ? search.phone : (identity?.phone ?? ""),
  );
  const [phone, setPhone] = useState(
    typeof search.phone === "string" && search.phone ? search.phone.replace(/[^0-9]/g, "") : (identity?.phone ?? ""),
  );
  const [gate, setGate] = useState<"idle" | "checking" | "admin" | "denied" | "unavailable">("idle");
  const [gateMessage, setGateMessage] = useState("");
  const [audience, setAudience] = useState<Audience | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [elig, setElig] = useState<Elig | null>(null);
  const [eligLoading, setEligLoading] = useState(false);
  const [step, setStep] = useState<"compose" | "confirm">("compose");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sent, setSent] = useState<SendResult | null>(null);

  // Draft autosave: load once, save on change; back never discards.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (raw) {
        const d = JSON.parse(raw) as { audience?: Audience; title?: string; body?: string };
        if (d.audience === "hometeam" || d.audience === "neighbors" || d.audience === "both") setAudience(d.audience);
        if (typeof d.title === "string") setTitle(d.title.slice(0, 80));
        if (typeof d.body === "string") setBody(d.body.slice(0, 500));
      }
    } catch {
      /* no draft — start fresh */
    }
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ audience, title, body }));
    } catch {
      /* private mode — compose still works */
    }
  }, [audience, title, body]);

  const checkGate = useCallback(async (p: string) => {
    setGate("checking");
    try {
      const res = await fetch(`/api/directory/list?phone=${encodeURIComponent(p)}`);
      const data = (await res.json().catch(() => null)) as { ok?: boolean; role?: string; error?: string } | null;
      if (res.ok && data?.ok && data.role === "admin") {
        setGate("admin");
      } else if (res.status === 403 || (res.ok && data?.ok && data.role !== "admin")) {
        setGate("denied");
      } else {
        setGate("unavailable");
        setGateMessage(data?.error ?? "Couldn't check the roster — try again in a moment.");
      }
    } catch {
      setGate("unavailable");
      setGateMessage("No connection right now — the composer will be here when you're back.");
    }
  }, []);

  useEffect(() => {
    if (phone.length >= 10) void checkGate(phone);
    else setGate("idle");
  }, [phone, checkGate]);

  const refreshElig = useCallback(
    async (p: string, a: Audience) => {
      setEligLoading(true);
      try {
        const res = await fetch(
          `/api/directory/eligible?phone=${encodeURIComponent(p)}&audience=${encodeURIComponent(a)}`,
        );
        const data = (await res.json().catch(() => null)) as Elig | null;
        if (res.ok && data?.ok) setElig(data);
        else setElig(null);
      } catch {
        setElig(null);
      } finally {
        setEligLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (gate === "admin" && audience) void refreshElig(phone, audience);
    else setElig(null);
  }, [gate, audience, phone, refreshElig]);

  const canReview = title.trim().length > 0 && body.trim().length > 0 && audience !== null;

  const doSend = async () => {
    if (!audience) return;
    setSending(true);
    setSendError(null);
    try {
      const res = await fetch("/api/directory/notice", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ phone, title: title.trim(), body: body.trim(), audience }),
      });
      const data = (await res.json().catch(() => null)) as SendResult | null;
      if (res.ok && data?.ok) {
        setSent(data);
        try {
          localStorage.removeItem(DRAFT_KEY);
        } catch {
          /* draft already gone */
        }
      } else {
        setSendError(data?.error ?? "That didn't go through — nothing was sent.");
      }
    } catch {
      setSendError("No connection — nothing was sent.");
    } finally {
      setSending(false);
    }
  };

  return (
    <AppShell>
      <div className="flex flex-col gap-4 px-4 pt-5">
        <header>
          <h1 className="text-h1">Group notice</h1>
          <p className="mt-0.5 text-small text-sg-ink-soft">One message to the community — reviewed before it goes.</p>
        </header>

        {phone.length < 10 ? (
          <Card>
            <label className="flex flex-col gap-1.5">
              <span className="text-btn font-medium">Your outreach phone</span>
              <div className="flex gap-2">
                <input
                  value={phoneInput}
                  onChange={(e) => setPhoneInput(e.target.value)}
                  placeholder="e.g. 415 555-0142"
                  inputMode="tel"
                  className="min-h-[52px] w-full min-w-0 flex-1 rounded-[12px] border-2 border-sg-line bg-sg-card px-4 text-body text-sg-ink outline-none focus:border-sg-ink"
                />
                <Button
                  variant="secondary"
                  disabled={!phoneLooksOk(phoneInput)}
                  onClick={() => setPhone(phoneInput.replace(/[^0-9]/g, ""))}
                >
                  Open
                </Button>
              </div>
            </label>
          </Card>
        ) : gate === "checking" || gate === "idle" ? (
          <SkeletonRows rows={3} />
        ) : gate === "denied" ? (
          <EmptyState
            icon={<HandsIcon size={28} />}
            title={CALM_404}
            body="If you're on the outreach team, check the number and try again, no rush."
          />
        ) : gate === "unavailable" ? (
          <EmptyState
            icon={<HandsIcon size={28} />}
            title="The composer isn't up yet"
            body={gateMessage}
            steps={<Button variant="secondary" full onClick={() => void checkGate(phone)}>Try again</Button>}
          />
        ) : sent ? (
          <Card>
            <h2 className="text-h2">Sent to {sent.sent ?? 0} {sent.sent === 1 ? "person" : "people"}.</h2>
            <p className="mt-1 text-small text-sg-ink-soft">
              {(sent.skippedAfterHours ?? 0) > 0
                ? `${sent.skippedAfterHours} will get it in business hours.`
                : "Everyone opted in got it now."}
              {(sent.skippedNoToken ?? 0) > 0
                ? ` ${sent.skippedNoToken} without the app on this device missed this one.`
                : ""}
            </p>
            <div className="mt-3 flex flex-col gap-2">
              <Link to="/outreach/directory/notices" search={{ phone }} className="block w-full">
                <Button variant="secondary" full>See sent notices</Button>
              </Link>
              <Link to="/outreach/directory" search={{ phone }} className="block w-full">
                <Button variant="quiet" full>Back to community</Button>
              </Link>
            </div>
          </Card>
        ) : step === "confirm" && audience ? (
          <>
            <Card>
              <h2 className="text-h2">Ready to send?</h2>
              <div className="mt-3 rounded-[12px] bg-sg-paper p-3">
                <p className="text-body font-medium">{title.trim()}</p>
                <p className="mt-1 whitespace-pre-wrap break-words text-body text-sg-ink-soft">{body.trim()}</p>
              </div>
              <dl className="mt-3 flex flex-col gap-2 text-small">
                <div className="flex gap-2">
                  <dt className="w-20 shrink-0 font-medium">Who</dt>
                  <dd className="text-sg-ink-soft">
                    {elig ? `${elig.eligible ?? 0} opted in · ${audienceLabel(audience)}` : audienceLabel(audience)}
                  </dd>
                </div>
                <div className="flex gap-2">
                  <dt className="w-20 shrink-0 font-medium">Channel</dt>
                  <dd className="text-sg-ink-soft">App notification only — never SMS.</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="w-20 shrink-0 font-medium">Hours</dt>
                  <dd className="text-sg-ink-soft">
                    Sent now · {elig?.skippedAfterHours ?? 0} skipped until business hours.
                  </dd>
                </div>
                <div className="flex gap-2">
                  <dt className="w-20 shrink-0 font-medium">From</dt>
                  <dd className="text-sg-ink-soft">MPRCC outreach.</dd>
                </div>
              </dl>
            </Card>
            {sendError ? (
              <p className="rounded-[12px] bg-sg-clay-wash px-3 py-2 text-small text-sg-clay" role="alert">
                {sendError}
              </p>
            ) : null}
            <Button full disabled={sending} onClick={() => void doSend()}>
              {sending ? "Sending…" : `Send to ${elig?.eligible ?? "?"} ${elig?.eligible === 1 ? "person" : "people"}`}
            </Button>
            <Button variant="secondary" full disabled={sending} onClick={() => { setStep("compose"); setSendError(null); }}>
              Back to edit
            </Button>
          </>
        ) : (
          <>
            <Card>
              <fieldset>
                <legend className="text-btn font-medium">Who is this for?</legend>
                <div className="mt-2 flex flex-col gap-2" role="radiogroup" aria-label="Audience">
                  {(["hometeam", "neighbors", "both"] as Audience[]).map((a) => (
                    <label
                      key={a}
                      className={
                        audience === a
                          ? "flex min-h-[52px] cursor-pointer items-center gap-3 rounded-[12px] border-2 border-sg-sage bg-sg-sage-wash px-4"
                          : "flex min-h-[52px] cursor-pointer items-center gap-3 rounded-[12px] border-2 border-sg-line bg-sg-card px-4"
                      }
                    >
                      <input
                        type="radio"
                        name="notice-audience"
                        checked={audience === a}
                        onChange={() => setAudience(a)}
                        className="h-5 w-5 accent-[#2F6B4F]"
                      />
                      <span className="text-body">{audienceLabel(a)}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            </Card>

            <Card>
              <label className="flex flex-col gap-1.5">
                <span className="text-btn font-medium">Headline</span>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value.slice(0, 80))}
                  placeholder="Short — it's the notification headline"
                  maxLength={80}
                  className="min-h-[52px] w-full rounded-[12px] border-2 border-sg-line bg-sg-card px-4 text-body text-sg-ink outline-none focus:border-sg-ink"
                />
                <span className="text-small text-sg-ink-soft" aria-live="polite">{title.length}/80</span>
              </label>
              <label className="mt-3 flex flex-col gap-1.5">
                <span className="text-btn font-medium">Message</span>
                <textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value.slice(0, 500))}
                  placeholder="A line or two — words, place names, and times"
                  maxLength={500}
                  rows={4}
                  className="w-full rounded-[12px] border-2 border-sg-line bg-sg-card px-4 py-3 text-body text-sg-ink outline-none focus:border-sg-ink"
                />
                <span className="text-small text-sg-ink-soft" aria-live="polite">{body.length}/500 · Links won&apos;t be tappable — keep it to words, place names, and times.</span>
              </label>
            </Card>

            <Card className="bg-sg-sky/10">
              <p className="text-small" aria-live="polite">
                {eligLoading
                  ? "Counting who's opted in…"
                  : audience && elig
                    ? `Will reach ~${elig.eligible ?? 0} opted-in ${elig.eligible === 1 ? "member" : "members"} right now (${elig.skippedAfterHours ?? 0} skipped — after hours).`
                    : "Choose who this is for to see who it reaches."}
              </p>
              <p className="mt-1 text-small text-sg-ink-soft">
                App notifications only · business hours 8am–6pm weekdays unless someone opted in for after-hours · never SMS.
              </p>
            </Card>

            {sendError ? (
              <p className="rounded-[12px] bg-sg-clay-wash px-3 py-2 text-small text-sg-clay" role="alert">
                {sendError}
              </p>
            ) : null}
            <Button full disabledReason={canReview ? undefined : "A headline, a message, and an audience first"} onClick={() => setStep("confirm")}>
              Review before sending
            </Button>
            <Link to="/outreach/directory" search={{ phone }} className="block w-full">
              <Button variant="quiet" full>Cancel — draft is saved</Button>
            </Link>
          </>
        )}
      </div>
    </AppShell>
  );
}

export const Route = createFileRoute("/outreach/directory/notice")({ component: NoticeComposerPage });
