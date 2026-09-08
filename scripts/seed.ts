/**
 * One-shot ops script: seed the REAL Marin resources + roster into live tables.
 * Idempotent (deterministic UUIDv5 ids + ON CONFLICT DO NOTHING).
 *
 *   bun scripts/seed.ts
 *
 * Requires the schema (bun scripts/apply-schema.ts) and a working DATABASE_URL.
 */
import { seedDemoData, pingDb } from "~/lib/bootstrap";

async function main() {
  console.log("[safeground] target:", await pingDb());
  const r = await seedDemoData();
  console.log(`[safeground] seed: resources=${r.resourcesTotal} (${r.resourcesInserted} ensured), sweeps=${r.sweepsTotal} (${r.sweepsInserted} ensured), hometeam=${r.hometeamTotal}, needs=${r.needsTotal}, alerts=${r.alertsTotal}, roster=${r.rosterTotal}`);
  process.exit(0);
}

main().catch((e: Error) => {
  console.error("[safeground] FAILED:", e.message);
  process.exit(1);
});
