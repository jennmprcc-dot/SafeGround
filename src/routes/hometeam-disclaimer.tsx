/**
 * HomeTeam Safety & Liability Disclaimer — static page (owner-approved verbatim
 * 2026-09-11). The legal body is rendered from the single immutable source in
 * src/components/disclaimer.tsx and is EN-only (mirrors /terms — never
 * translate legal text). UI chrome (back link, helper line) is i18n'd.
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell } from "~/components/shell";
import { Card } from "~/components/ui";
import {
  DisclaimerText,
  HOMETEAM_DISCLAIMER_BLOCKS,
  HOMETEAM_DISCLAIMER_TITLE,
} from "~/components/disclaimer";
import { useLanguage } from "~/lib/i18n";

function HomeTeamDisclaimerPage() {
  const { t } = useLanguage();
  return (
    <AppShell>
      <div className="flex flex-col gap-4 px-4 pt-5 pb-6">
        <Link to="/hometeam" className="inline-flex min-h-[44px] items-center text-small text-sg-sky underline underline-offset-2">
          ← {t("disc_back_ht")}
        </Link>
        <header>
          <h1 className="text-h1">{HOMETEAM_DISCLAIMER_TITLE}</h1>
          <p className="mt-0.5 text-body text-sg-ink-soft">{t("disc_read_anytime")}</p>
        </header>
        <Card>
          <DisclaimerText blocks={HOMETEAM_DISCLAIMER_BLOCKS} />
        </Card>
      </div>
    </AppShell>
  );
}

export const Route = createFileRoute("/hometeam-disclaimer")({
  component: HomeTeamDisclaimerPage,
});