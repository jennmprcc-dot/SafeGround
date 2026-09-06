/**
 * One-shot ops script: apply schema.sql to the live database, then seed demo
 * content. Idempotent — safe to re-run.
 *
 *   bun scripts/apply-schema.ts
 *   bun scripts/seed.ts        (or --both to run schema + seed together)
 *
 * Requires a working DATABASE_URL. If it still contains Supabase's
 * [YOUR-PASSWORD] placeholder, db.ts throws a calm, actionable error.
 */
import { bootstrap, applySchema, seedDemoData, pingDb } from "~/lib/bootstrap";

const arg = process.argv[2] ?? "";

async function main() {
  console.log("[safeground] target:", pingDb());
  if (arg === "--both" || arg === "bootstrap") {
    const r = await bootstrap();
    console.log(`[safeground] schema: ${r.applied} applied, ${r.skipped} skipped, shim=${r.shimInstalled}`);
    console.log(`[safeground] seed: resources=${r.resourcesTotal} (${r.resourcesInserted} inserted), sweeps=${r.sweepsTotal} (${r.sweepsInserted} inserted)`);
    console.log(`[safeground] seed: hometeam=${r.hometeamTotal}, needs=${r.needsTotal}, alerts=${r.alertsTotal}`);
    process.exit(0);
  }
  const s = await applySchema();
  console.log(`[safeground] schema: ${s.applied} applied, ${s.skipped} skipped, authShim=${s.shimInstalled}`);
  for (const st of s.statements) {
    if (!st.ok) console.log("  FAILED:", st.info);
  }
  if (arg === "--seed") {
    const r = await seedDemoData();
    console.log(`[safeground] seed: resources=${r.resourcesTotal} sweeps=${r.sweepsTotal} hometeam=${r.hometeamTotal} needs=${r.needsTotal} alerts=${r.alertsTotal}`);
  }
  process.exit(0);
}

main().catch((e: Error) => {
  console.error("[safeground] FAILED:", e.message);
  process.exit(1);
});
