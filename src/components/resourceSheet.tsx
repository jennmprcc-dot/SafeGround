/**
 * Resource detail bottom sheet (WIREFRAMES §2d) — the standard detail pane
 * for the Navigator. Missing fields render as "Not confirmed yet — call ahead
 * if you can" (never blank). Sign-in gated [Suggest a correction] explains why.
 */
import { Link } from "@tanstack/react-router";
import { BottomSheet, Button, ConsentReceipt, StatusBadge, useToasts } from "~/components/ui";
import { useAuth } from "~/lib/auth";
import { CATEGORY_MAP, verifiedLabel } from "~/lib/data";
import type { DemoResource } from "~/lib/data";
import { ClockIcon, MapPinIcon, NavigateIcon, PenIcon, PhoneIcon, BookmarkIcon } from "~/lib/icons";

const NOT_CONFIRMED = "Not confirmed yet — call ahead if you can";

/* ── map link (general Google Maps search URL for any address/place) ─ */
export function mapLink(addr: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addr)}`;
}

export function ResourceSheet({
  resource,
  onClose,
  onDirections,
}: {
  resource: DemoResource | null;
  onClose: () => void;
  onDirections: (r: DemoResource) => void;
}) {
  const { signedIn, displayName } = useAuth();
  const { push } = useToasts();

  if (!resource) return null;
  const cat = CATEGORY_MAP[resource.category];

  return (
    <BottomSheet open={!!resource} onClose={onClose} title={resource.name}>
      <div className="flex flex-col gap-4 pb-2">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge kind="Verified">Verified</StatusBadge>
          <span className="text-small text-sg-ink-soft">
            {cat.name} · {verifiedLabel(resource.verifiedAt)}
          </span>
        </div>

        <div className="flex flex-col gap-2.5 rounded-[16px] border border-sg-line bg-sg-paper p-4 text-body">
          <p className="flex items-start gap-2 text-sg-ink">
            <MapPinIcon size={20} className="mt-0.5 shrink-0 text-sg-ink-soft" aria-hidden />
            {resource.unconfirmed?.includes("address") ? (
              NOT_CONFIRMED
            ) : (
              <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span>{resource.address}</span>
                {resource.address ? (
                  <a
                    href={mapLink(resource.address)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sg-sky underline underline-offset-2"
                  >
                    Open map
                  </a>
                ) : null}
              </span>
            )}
          </p>
          <p className="flex items-start gap-2 text-sg-ink">
            <ClockIcon size={20} className="mt-0.5 shrink-0 text-sg-ink-soft" aria-hidden />
            {resource.unconfirmed?.includes("hours") ? NOT_CONFIRMED : resource.hours}
          </p>
          {resource.phone && !resource.unconfirmed?.includes("phone") ? (
            <p className="flex items-start gap-2">
              <PhoneIcon size={20} className="mt-0.5 shrink-0 text-sg-ink-soft" aria-hidden />
              <span className="flex flex-wrap items-center gap-3">
                <a href={`tel:${resource.phone}`} className="text-sg-sky underline underline-offset-2">
                  {resource.phone}
                </a>
                <a
                  href={`tel:${resource.phone}`}
                  className="inline-flex min-h-[44px] items-center rounded-[12px] bg-sg-sage px-4 text-btn font-semibold text-white"
                >
                  Call
                </a>
              </span>
            </p>
          ) : (
            <p className="flex items-start gap-2 text-sg-ink-soft">
              <PhoneIcon size={20} className="mt-0.5 shrink-0" aria-hidden />
              {NOT_CONFIRMED}
            </p>
          )}
        </div>

        <div>
          <h3 className="text-h2">What to expect</h3>
          <p className="mt-1.5 text-body text-sg-ink-soft">
            {resource.unconfirmed?.includes("note") ? NOT_CONFIRMED : resource.note}
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <Button variant="secondary" full onClick={() => onDirections(resource)}>
            <NavigateIcon size={20} aria-hidden />
            Get directions
          </Button>
          <Button
            variant="secondary"
            full
            onClick={() => push({ kind: "success", message: "Saved — it'll show on your saved list." })}
          >
            <BookmarkIcon size={20} aria-hidden />
            Save
          </Button>
          {signedIn ? (
            <Button
              variant="text"
              full
              onClick={() =>
                push({ kind: "success", message: "Thanks — your correction goes to outreach for a look." })
              }
            >
              <PenIcon size={18} aria-hidden />
              Suggest a correction
            </Button>
          ) : (
            <Button
              variant="text"
              full
              onClick={() => push({ kind: "info", message: "Sign in to suggest a correction — so outreach can follow up." })}
            >
              <PenIcon size={18} aria-hidden />
              Suggest a correction (sign in so outreach can follow up)
            </Button>
          )}
          <Button variant="quiet" full onClick={onClose}>
            Back to list
          </Button>
        </div>

        <ConsentReceipt
          who="Everyone who opens the app"
          what="This listing"
          howLong="Until outreach updates it"
          stopLabel="Report a listing problem"
          onStop={() => push({ kind: "info", message: "Thanks — outreach will take a look." })}
        />
        {signedIn ? (
          <p className="text-small text-sg-ink-soft">Signed in as {displayName} — corrections are attributed to you.</p>
        ) : null}
        <Link to="/" className="mt-2 text-small text-sg-sky underline underline-offset-2">
          Back to Home
        </Link>
      </div>
    </BottomSheet>
  );
}