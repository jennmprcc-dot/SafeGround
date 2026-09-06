import { HeadContent, Outlet, Scripts, createRootRoute } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { AuthProvider } from "~/lib/auth";
import appCss from "~/styles/app.css?url";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
      { title: "SafeGround — find help, rest, and people who care" },
      {
        name: "description",
        content:
          "SafeGround is a calm mobile-first companion for finding resources, seeing sweep heads-ups, and checking in with trusted people. No account needed to look. No background location, ever.",
      },
      { name: "theme-color", content: "#F7F4EC" },
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
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}