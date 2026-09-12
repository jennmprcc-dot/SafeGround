/**
 * "I Want to Help" (PASS 1 + PASS 2, owner-directed 2026-09-12) — the donor /
 * community-support side of SafeGround. The HomeTeam needs-queue loop is
 * decommissioned. This page is the mode's home: a primary Give Money link
 * (BetterWorld) + the PASS 2 "Donate an item" offer form (three delivery
 * paths: porch drop / scheduled pickup / MPRCC porch). PASS 2 landed the real
 * donation-offer form here; the Give sub-tab (?view=give) shows the same page.
 */
import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "~/components/shell";
import { Button, Card } from "~/components/ui";
import { DonateItemForm } from "~/components/donationForms";
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

  return (
    <AppShell>
      <div className="flex flex-col gap-4 px-4 pt-5">
        {/* Per-mode hero (kept from NAV_REFACTOR_SPEC) — giving, not claiming. */}
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

        {/* Donate an item — Pass 2 offer form (owner-directed 2026-09-12):
            porch drop / scheduled pickup / MPRCC porch, photo optional,
            phone only for staff coordination. */}
        <DonateItemForm />

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