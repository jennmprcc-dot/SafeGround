/**
 * LegalLinks — the small muted "Read our Terms & Conditions and Privacy
 * Policy." line shown under SMS opt-in disclosures (Twilio toll-free review
 * requires the legal pages to be reachable from the opt-in surface).
 * Copy-only; the anchors route to /terms and /privacy.
 */
import { Link } from "@tanstack/react-router";
import { useLanguage } from "~/lib/i18n";

export function LegalLinks({ className = "" }: { className?: string }) {
  const { t } = useLanguage();
  return (
    <p className={`text-small text-sg-ink-soft ${className}`}>
      {t("legal_read")}{" "}
      <Link
        to="/terms"
        className="inline-flex min-h-[44px] items-center text-sg-sky underline underline-offset-2"
      >
        {t("legal_terms")}
      </Link>
      {t("legal_and")}{" "}
      <Link
        to="/privacy"
        className="inline-flex min-h-[44px] items-center text-sg-sky underline underline-offset-2"
      >
        {t("legal_privacy")}
      </Link>
    </p>
  );
}