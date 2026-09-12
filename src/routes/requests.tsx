/**
 * My Requests (NAV_REFACTOR_SPEC §2 — the ONE new route in the refactor).
 * Light composite, ZERO new backend:
 * (a) [removed PASS 1 2026-09-12] the HomeTeam needs section was an entry
 *     point to the decommissioned claim/deliver queue — gone with the loop.
 *     PASS 2 brings the separate offers/needs staff queues;
 * (b) own peer-support status — no READ endpoint exists today (searched
 *     server fns + peerSupportServer: only the POST queue + table check),
 *     so v1 ships the localStorage receipt fallback: the peer-support done
 *     screen stamps sg.peer_receipt and this page shows it. Documented per
 *     spec §10.2 — do NOT invent an endpoint;
 * (c) "My alerts" section linking /alerts/mine + "Send an alert" /alerts/new.
 */
import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell } from "~/components/shell";
import { Button, Card } from "~/components/ui";
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
  const [receipt, setReceipt] = useState<{ at: string; note: string } | null>(null);

  useEffect(() => {
    setReceipt(readReceipt());
  }, []);

  return (
    <AppShell>
      <div className="flex flex-col gap-4 px-4 pt-5">
        <header>
          <h1 className="text-h1">{t("nav_nb_requests")}</h1>
          <p className="mt-0.5 text-small text-sg-ink-soft">
            What you asked for, and where it stands — nothing leaves this phone except what you already shared.
          </p>
        </header>

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