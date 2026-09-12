import { HeadContent, Outlet, Scripts, createRootRoute } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useEffect } from "react";

import { AuthProvider } from "~/lib/auth";
import { getLang } from "~/lib/i18n";
import { WelcomeOverlay } from "~/components/welcome";
import { SafetyGate } from "~/components/safetyGate";
import appCss from "~/styles/app.css?url";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
      { title: "SafeGround — by MPRCC" },
      {
        name: "description",
        content:
          "SafeGround is a calm mobile-first companion from MPRCC for finding resources, seeing sweep heads-ups, and checking in with trusted people. No account needed to look. No background location, ever.",
      },
      { name: "theme-color", content: "#F7F4EC" },
      // Stale-bundle class fix (owner report 2026-09-11): a shared Android can
      // pin an old shell where taps register but the screen doesn't move. The
      // server's Cache-Control can't be set here, so revalidate the DOCUMENT on
      // every load — asset URLs are hashed, so revalidation pulls the new build.
      { httpEquiv: "Cache-Control", content: "no-cache, no-store, must-revalidate" },
      { httpEquiv: "Pragma", content: "no-cache" },
      // Social sharing card (branding pass): absolute URL to the live logo.
      { property: "og:title", content: "SafeGround — by MPRCC" },
      { property: "og:description", content: "A calm mobile-first companion from MPRCC for finding help, rest, and people who care." },
      { property: "og:type", content: "website" },
      { property: "og:image", content: "https://3ece348267758ca697d7eddcee09689c.ctonew.app/logo-header.png" },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:title", content: "SafeGround — by MPRCC" },
      { name: "twitter:image", content: "https://3ece348267758ca697d7eddcee09689c.ctonew.app/logo-header.png" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      // Brand + Add-to-Home-Screen (Wave 2a): SafeGround identity straight from
      // the owner's brand pack; the manifest names the app "SafeGround".
      { rel: "manifest", href: "/site.webmanifest" },
      { rel: "icon", type: "image/png", href: "/favicon.png", sizes: "32x32" },
      { rel: "apple-touch-icon", href: "/apple-touch-icon.png", sizes: "180x180" },
    ],
  }),
  notFoundComponent: () => (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-sg-paper px-6 text-center">
      <p className="text-h2">This page isn't here.</p>
      <p className="text-body text-sg-ink-soft">Nothing was lost — the path just isn't one we made.</p>
      <a href="/" className="text-sg-sky underline underline-offset-2">
        Back to Home
      </a>
    </div>
  ),
  component: RootComponent,
});

function RootComponent() {
  return (
    <AuthProvider>
      <RootDocument>
        <Outlet />
      </RootDocument>
    </AuthProvider>
  );
}

function RootDocument({ children }: { children: ReactNode }) {
  // EN|ES (PR-B): reflect the persisted language on <html lang>. The toggle
  // keeps it in sync after load; this covers first paint + SSR.
  useEffect(() => {
    try {
      document.documentElement.lang = getLang();
    } catch {
      /* non-browser render — the static lang="en" stands in */
    }
  }, []);
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        {/* Single first-open Safety &amp; Liability gate — z-[70], above
            WelcomeOverlay's z-[60], so it truly comes first and nothing is
            usable beneath it until accepted (fail-closed). */}
        <SafetyGate />
        <WelcomeOverlay />
        <Scripts />
      </body>
    </html>
  );
}