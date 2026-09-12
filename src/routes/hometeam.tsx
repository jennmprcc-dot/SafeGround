/**
 * "I Want to Help" (PASS 1, owner-directed 2026-09-12) — the donor /
 * community-support side of SafeGround. The HomeTeam needs-queue loop
 * (join → needs feed → claim → deliver) is decommissioned: no join flow,
 * no claim/deliver UI, no entry points. This page is the mode's home:
 * a primary Give Money link (BetterWorld) + calm placeholder copy.
 * PASS 2 adds the real donation-offer forms and the separate
 * offers/needs staff queues (DB + SMS paths stay intact until then).
 */
import { createFileRoute, useSearch } from "@tanstack/react-router";
import { AppShell } from "~/components/shell";
import { Button, Card } from "~/components/ui";
import { useLanguage } from "~/lib/i18n";
import { HandsIcon } from "~/lib/icons";

export const GIVE_URL = "https://mprcc.betterworld.org/";

/** External link styled with the app's button language — opens in a new
 * tab with noopener (owner-directed 2026-09-12). */
function GiveLink({ variant = "primary" }: { variant?: "primary" | "secondary" }) {
  const { t } = useLanguage();
  return (
    <a href={GIVE_URL} target="_blank" rel="noopener noreferrer" className="block w-full">
      <Button full variant={variant}>
        <HandsIcon size={18} aria-hidden /> {t("give_money")}
      </Button>
    </a>
  );
}

function HomeTeamPage() {
  const { t } = useLanguage();
  const search = useSearch({ from: "/hometeam" }) as { view?: string };
  const giveMode = search.view === "give";

  return (
    <AppShell>
      <div className="flex flex-col gap-4 px-4 pt-5">
        {/* Per-mode hero (kept from NAV_REFACTOR_SPEC) — sub updated for the
            decommissioned queue: giving, not claiming. */}
        <p className="text-h1 text-sg-ink">{t("mode_hero_ht")}</p>
        <p className="-mt-3 text-small text-sg-ink-soft">{t("mode_hero_ht_sub")}</p>

        {/* Give Money — primary spot (owner-directed 2026-09-12). */}
        <Card className="border-sg-sage/60 bg-sg-sage-wash/40">
          <div className="flex flex-col gap-3">
            <div className="flex items-start gap-3">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[12px] bg-sg-sage text-white" aria-hidden>
                <HandsIcon size={24} />
              </span>
              <div className="min-w-0 flex-1">
                <h1 className="text-h2">{t("give_money")}</h1>
                <p className="mt-0.5 text-small text-sg-ink-soft">{t("give_placeholder")}</p>
              </div>
            </div>
            <GiveLink />
          </div>
        </Card>

        {/* 3-mode nav (?view=give): the Give panel — same Give Money card,
            kept as the sub-tab's surface until PASS 2 lands the offer forms. */}
        {giveMode ? (
          <section aria-label={t("nav_ht_give")} className="rounded-[16px] border border-sg-sage/60 bg-sg-sage-wash/40 p-4">
            <h2 className="text-h2">{t("nav_ht_give")}</h2>
            <p className="mt-0.5 text-small text-sg-ink-soft">{t("give_placeholder")}</p>
            <div className="mt-3">
              <GiveLink variant="secondary" />
            </div>
          </section>
        ) : null}

        <p className="text-small text-sg-ink-soft">{t("home_noloc")}</p>
      </div>
    </AppShell>
  );
}

export const Route = createFileRoute("/hometeam")({
  validateSearch: (search: Record<string, unknown>) => ({
    view: typeof search?.view === "string" ? search.view : undefined,
  }),
  component: HomeTeamPage,
});