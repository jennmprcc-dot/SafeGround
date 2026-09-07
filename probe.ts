// Probe wrapper: import the built TanStack Start server and serve it on :3123
// (NEVER :3000 — serve.ts hard-kills that port). Run from the site dir so Bun
// auto-loads .env.local. Usage: bun probe.ts
import handler from "./dist/server/server.js";

Bun.serve({
  port: 3123,
  fetch: handler.fetch,
});
console.log("probe on :3123");