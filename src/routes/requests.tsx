/**
 * My Requests (NAV_REFACTOR_SPEC §2 — the ONE new route in the refactor).
 *
 * (a) PASS 2 + owner bug 2026-09-16: "My needs / my requests don't populate"
 *     — a neighbor who submitted a donation request or offer could never see
 *     their own rows. This page now lists the caller's OWN donation requests
 *     + offers from /api/donations/mine (caller-keyed by phone, last-10-digit
 *     match on contact_phone — the same identity as push_tokens; the route
 *     returns ONLY the caller's rows, pruned of addresses/photos/phones).
 * (b) own peer-support status — no READ endpoint exists today (searched
 *     server fns + peerSupportServer: only the POST queue + table check),
 *     so v1 ships the localStorage receipt fallback: the peer-support done
 *     screen stamps sg.peer_receipt and this page shows it. Documented per
 *     spec §10.2 — do NOT invent an endpoint;
 * (c) "My alerts" section linking /alerts/mine + "Send an alert" /alerts/new.
 */
import { useCallback, useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell } from "~/components/shell";
import { Button, Card } from "~/components/ui";
import { useLanguage } from "~/lib/i18n";
import type { I18nKey } from "~/lib/i18n";
import { getAlertIdentity } from "~/lib/alertIdentity";

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

/* ── My donation requests & offers (owner bug 2026-09-16) ─────────── */

interface MyDonationRow {
  kind: "offer" | "request";
  id: string;
  category: string;
  title: string;
  quantity: string | null;
  size: string | null;
  status: string;
  createdAt: string;
}

/** Calm status line — open/claimed/in_route/completed map to plain-language
 * EN/ES (in_route added 2026-09-16: staff marked the item on its way). */
function statusKey(status: string): I18nKey {
  switch (status) {
    case "open":
      return "myr_status_open";
    case "claimed":
      return "myr_status_claimed";
    case "in_route":
      return "myr_status_in_route";
    case "completed":
      return "myr_status_completed";
    default:
      return "myr_status_unknown";
  }
}

export function MyDonationsSection() {
  const { t, lang } = useLanguage();
  const [rows, setRows] = useState<MyDonationRow[] | null>(null); // null = loading
  const [needsPhone, setNeedsPhone] = useState(false);
  const [error, setError] = useState(false);

  const load = useCallback(() => {
    const identity = getAlertIdentity();
    if (!identity) {
      setNeedsPhone(true);
      setRows([]);
      return;
    }
    setNeedsPhone(false);
    setError(false);
    fetch(`/api/donations/mine?phone=${encodeURIComponent(identity.phone)}`, {
      headers: { "x-sg-phone": identity.phone },
    })
      .then((r) => r.json().catch(() => null))
      .then((d: { ok?: boolean; rows?: MyDonationRow[] } | null) => {
        if (!d || d.ok !== true) {
          setError(true);
          setRows([]);
          return;
        }
        setRows(d.rows ?? []);
      })
      .catch(() => {
        setError(true);
        setRows([]);
      });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <section aria-label={t("myr_section")} className="flex flex-col gap-3">
      <h2 className="text-h2">{t("myr_section")}</h2>
      <p className="-mt-2 text-small text-sg-ink-soft">{t("myr_sub")}</p>

      {needsPhone ? (
        <Card>
          <p className="text-body font-medium">{t("myr_need_phone")}</p>
          <p className="mt-0.5 text-small text-sg-ink-soft">
            {t("nav_nb_itemreq")} · {t("nav_ht_give")}
          </p>
        </Card>
      ) : error ? (
        <Card>
          <p className="text-body font-medium">{t("myr_err")}</p>
          <div className="mt-3">
            <Button variant="secondary" full onClick={load}>
              {t("sw_refresh")}
            </Button>
          </div>
        </Card>
      ) : rows === null ? (
        <Card>
          <p className="text-body text-sg-ink-soft">{t("myr_loading")}</p>
        </Card>
      ) : rows.length === 0 ? (
        <Card>
          <p className="text-body font-medium">{t("myr_empty")}</p>
          <p className="mt-0.5 text-small text-sg-ink-soft">{t("myr_empty_sub")}</p>
        </Card>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((r) => (
            <li key={`${r.kind}-${r.id}`}>
              <Card>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-body font-medium leading-snug">{r.title}</p>
                    <p className="mt-0.5 text-small text-sg-ink-soft">
                      <span className="rounded-full bg-sg-paper px-2 py-0.5 text-small font-medium text-sg-ink">
                        {r.kind === "offer" ? t("myr_kind_offer") : t("myr_kind_request")}
                      </span>{" "}
                      · {r.category}
                      {r.quantity ? ` · ${r.quantity}` : ""}
                      {r.size ? ` · ${r.size}` : ""}
                    </p>
                  </div>
                  <p className="shrink-0 text-small text-sg-ink-soft">
                    {t("myr_sent").replace(
                      "{when}",
                      new Date(r.createdAt).toLocaleString(lang === "es" ? "es-US" : "en-US", {
                        month: "short",
                        day: "numeric",
                      }),
                    )}
                  </p>
                </div>
                <p className="mt-2 text-small font-medium text-sg-sage-deep">{t(statusKey(r.status))}</p>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function RequestsPage() {
  const { t } = useLanguage();
  const [receipt, setReceipt] = useState<{ at: string; note: string } | null>(null);

  useEffect(() => {
    setReceipt(readReceipt());
  }, []);

  return (
    <AppShell>
      <div className="flex flex-col gap-6 px-4 pt-5">
        <header>
          <h1 className="text-h1">{t("nav_nb_requests")}</h1>
          <p className="mt-0.5 text-small text-sg-ink-soft">
            {t("myr_sub")} Nothing leaves this phone except what you already shared.
          </p>
        </header>

        <MyDonationsSection />

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
                  <Button variant="secondary" full>{t("nav_nb_peer")}</Button>
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