/**
 * Public Firebase web-push config (GET).
 *
 * Returns ONLY the browser-safe subset of the Firebase project config —
 * apiKey, authDomain, projectId, appId, messagingSenderId, vapidKey. These are
 * public by design (they ship inside every web page that talks to Firebase).
 * The service account / private key lives only in process.env and is NEVER
 * returned here or anywhere in the API.
 *
 * TanStack Start v1 server-route form: `createFileRoute('/api/...')` with a
 * `server.handlers` map (see PR: fix/api-routes-deploy).
 */
import { createFileRoute } from "@tanstack/react-router";
import { pushPublicConfig } from "~/lib/pushServer";

async function getConfig() {
  return Response.json(pushPublicConfig());
}

export const Route = createFileRoute("/api/push-config")({
  server: {
    handlers: {
      GET: getConfig,
    },
  },
});