/**
 * My Requests (NAV_REFACTOR_SPEC §2 — the ONE new route in the refactor).
 * Light composite, ZERO new backend:
 * (a) HomeTeam needs involving the on-device phone — listNeeds + local
 *     phone filter + NeedCard reuse (read-only here: no claim/deliver
 *     buttons; the feed on /hometeam stays the action surface);
 * (b) own peer-support status — NO read endpoint exists today (searched
 *     server fns + peerSupportServer: only the POST queue + table check),
 *     so v1 ships the localStorage receipt fallback: the peer-support done
 *     screen stamps sg.peer_receipt and this page shows it. Documented per
 *     spec §10.2 — do NOT invent an endpoint;
 * (c) "My alerts" section linking /alerts/mine + "Send an alert" /alerts/new.
 */
import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell } from "~/components/shell";
import { Button, Card, SkeletonRows } from "~/components/ui";
import { listNeeds } from "~/lib/server";
import { useLanguage } from "~/lib/i18n";

export const RECEIPT_KEY = "sg.peer_receipt";

function readReceipt(): { at: string; note: string } | null {
  try {
    const raw = localStorage.getItem(RECEIPT_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as { at?: string; note?: string };
    if (!p.at) return null;
    return { at: p.at, note: p.note ?? "" };
  } catch {
    return null;
  }
}

function RequestsPage() {
  const { t } = useLanguage();
  const [needs, setNeeds] = useState<{ status: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [receipt, setReceipt] = useState<{ at: string; note: string } | null>(null);

  useEffect(() => {
    let alive = true;
    setReceipt(readReceipt());
    listNeeds()
      .then((r) => {
        if (alive) {
          setNeeds(r.rows);
          setLoading(false);
        }
      })
      .catch(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  // listNeeds rows carry no claimer phone (first-name-only privacy), so
  // per-phone "claimed by me" matching is impossible client-side without a
  // new endpoint — and the spec forbids inventing one (§10.2). This section
  // shows the live open-needs count and links to the queue where claiming
  // happens; the peer receipt below is the phone-matched part.
  const openCount = needs.filter((n) => n.status === "open").length;

  return (
    <AppShell>
      <div className="flex flex-col gap-4 px-4 pt-5">
        <header>
          <h1 className="text-h1">{t("nav_nb_requests")}</h1>
          <p className="mt-0.5 text-small text-sg-ink-soft">
            What you asked for, and where it stands — nothing leaves this phone except what you already shared.
          </p>
        </header>

        <section aria-label={t("nav_ht_needs")} className="flex flex-col gap-3">
          <h2 className="text-h2">{t("nav_ht_needs")}</h2>
          {loading ? (
            <SkeletonRows rows={2} />
          ) : (
            <Card>
              <p className="text-body font-medium">
                {openCount === 0 ? "No open needs right now." : `${openCount} open ${openCount === 1 ? "need" : "needs"} in the queue.`}
              </p>
              <p className="mt-0.5 text-small text-sg-ink-soft">
                Claiming happens in the queue — names stay first-name-only, so this page can&apos;t match claims to your number (by design, no new lookup was added).
              </p>
              <div className="mt-3 flex flex-col gap-2">
                <Link to="/hometeam" className="block w-full">
                  <Button variant="secondary" full>Open the Needs Queue</Button>
                </Link>
                <Link to="/hometeam?view=give" className="block w-full">
                  <Button variant="quiet" full>Log a need</Button>
                </Link>
              </div>
            </Card>
          )}
        </section>

        <section aria-label={t("nav_nb_peer")} className="flex flex-col gap-3">
          <h2 className="text-h2">{t("nav_nb_peer")}</h2>
          {receipt ? (
            <Card>
              <p className="text-body font-medium">The team has your request.</p>
              <p className="mt-0.5 text-small text-sg-ink-soft">
                Sent {receipt.at}
                {receipt.note ? ` — “${receipt.note.slice(0, 120)}”` : ""}. A peer from MPRCC will reach out.
              </p>
            </Card>
          ) : (
            <Card>
              <p className="text-body font-medium">No peer request on this phone yet.</p>
              <p className="mt-0.5 text-small text-sg-ink-soft">One tap, no account — the team gets it, nobody else.</p>
              <div className="mt-3">
                <Link to="/peer-support" className="block w-full">
                  <Button variant="secondary" full>Talk to Peer</Button>
                </Link>
              </div>
            </Card>
          )}
        </section>

        <section aria-label="My alerts" className="flex flex-col gap-3">
          <h2 className="text-h2">My alerts</h2>
          <div className="flex flex-col gap-2">
            <Link to="/alerts/mine" className="block w-full">
              <Button variant="secondary" full>My alerts</Button>
            </Link>
            <Link to="/alerts/new" className="block w-full">
              <Button full>Send an alert</Button>
            </Link>
          </div>
        </section>
      </div>
    </AppShell>
  );
}

export const Route = createFileRoute("/requests")({ component: RequestsPage });
