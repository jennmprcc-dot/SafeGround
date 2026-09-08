/**
 * About & privacy (R-P2, R-P6, R-P11 reflection, plus the [?] route).
 * Plain-language: what we never do (no background location, no surveillance),
 * consent receipts everywhere, and how to stop sharing.
 *
 * EN|ES (owner P0 defect 4) — all user-facing strings via t().
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell } from "~/components/shell";
import { Card } from "~/components/ui";
import { useLanguage, type I18nKey } from "~/lib/i18n";

const promiseKeys: Array<{ title: I18nKey; body: I18nKey }> = [
  { title: "priv_p1t", body: "priv_p1b" },
  { title: "priv_p2t", body: "priv_p2b" },
  { title: "priv_p3t", body: "priv_p3b" },
  { title: "priv_p4t", body: "priv_p4b" },
  { title: "priv_p5t", body: "priv_p5b" },
  { title: "priv_p6t", body: "priv_p6b" },
];

function PrivacyPage() {
  const { t } = useLanguage();
  return (
    <AppShell>
      <div className="flex flex-col gap-4 px-4 pt-5 pb-6">
        <Link to="/" className="text-small text-sg-sky underline underline-offset-2 inline-flex min-h-[44px] items-center">
          {t("priv_back")}
        </Link>
        <header>
          <h1 className="text-h1">{t("priv_title")}</h1>
          <p className="mt-0.5 text-body text-sg-ink-soft">
            {t("priv_sub")}
          </p>
        </header>

        <div className="flex flex-col gap-3">
          {promiseKeys.map((p) => (
            <Card key={p.title}>
              <h2 className="text-h2">{t(p.title)}</h2>
              <p className="mt-1.5 text-body text-sg-ink-soft">{t(p.body)}</p>
            </Card>
          ))}
        </div>

        <Card>
          <h2 className="text-h2">{t("priv_data_title")}</h2>
          <p className="mt-1.5 text-body text-sg-ink-soft">
            {t("priv_data_body")}
          </p>
        </Card>

        <p className="text-small text-sg-ink-soft">
          {t("priv_footer")}
        </p>
      </div>
    </AppShell>
  );
}

export const Route = createFileRoute("/privacy")({ component: PrivacyPage });
