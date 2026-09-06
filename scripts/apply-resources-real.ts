/**
 * Migration: REAL Marin resources (replaces fictional seed) + category CHECK
 * constraint expansion + test-need cleanup. Idempotent — safe to re-run.
 *
 * Run: DATABASE_URL=... bun scripts/apply-resources-real.ts
 * (use `set -a && . ./.env.local && set +a` per team convention)
 */
import { sql } from "~/db";
import { MARIN_VERIFIED_AT, REAL_MARIN_RESOURCES, KEPT_EXISTING_RESOURCES } from "~/lib/marinResources";
import { uuid5 } from "~/lib/uuid5";

/** Deterministic id for the "add resource" admin writer (Jenn) — see RPC below. */
const JENN_UUID = uuid5("seed:outreach:jenn");

async function main() {
  // ── 1. Category CHECK: add 'transportation' + 'emergency' (idempotent) ──
  await sql()`
    alter table public.resources drop constraint if exists resources_category_check`;
  await sql()`
    alter table public.resources add constraint resources_category_check
    check (category in (
      'food', 'shelter', 'water', 'showers', 'clinics', 'charging', 'legal',
      'daycenters', 'transportation', 'emergency'
    ))`;
  console.log("[resources-real] category CHECK expanded (transportation + emergency)");

  // ── 2. Admin writer identity (Jenn Mallow) — verified_by FK target ──
  await sql()`
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_user_meta_data)
    values (${JENN_UUID}, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
            'demo+jenn@safeground.local', '', now(), now(), now(), '{"seed":true}')
    on conflict (id) do nothing`;
  await sql()`
    insert into public.users (id, display_name, role)
    values (${JENN_UUID}, 'Jenn Mallow (MPRCC)', 'outreach_admin')
    on conflict (id) do update set display_name = 'Jenn Mallow (MPRCC)', role = 'outreach_admin'`;
  console.log("[resources-real] admin writer users row ready");

  // ── 3. Delete the 13 fictional rows (deterministic seed ids) ──
  const fictional = [
    "r-st-marys", "r-bayview-meals", "r-harbor-night", "r-crescent-inn",
    "r-water-pavilion", "r-bath-house", "r-open-gate- clinic", // typo guard, never matches
    "r-open-gate-clinic", "r-community-health-bus", "r-lighthouse-charge",
    "r-harbor-wifi", "r-justice-clinic", "r-morning-star", "r-welcome-day",
  ];
  for (const fid of fictional) {
    await sql()`delete from public.resources where id = ${uuid5("resource:" + fid)}`;
  }
  // Belt+braces: also delete by exact name match (rows seeded before ids were
  // deterministic, or seeded by hand). Each name is verifiably fictional.
  const fictionalNames = [
    "St. Mary's Kitchen", "Bayview Community Meals", "Harbor Night Shelter",
    "Cresscent Motel Vouchers", "Crescent Motel Vouchers", "Water Pavilion",
    "Bath House", "Open Gate Clinic", "Community Health Bus", "Lighthouse Lounge",
    "Harbor Library Wi-Fi Bench", "Justice Street Legal Clinic", "Morning Star Day Center",
    "Welcome Table Day Center",
  ];
  for (const name of fictionalNames) {
    await sql()`delete from public.resources where name = ${name}`;
  }
  console.log("[resources-real] fictional rows deleted");

  // ── 4. Upsert the REAL Marin entries (the two already-real providers keep
  // their live rows: Street Chaplaincy re-upserted from KEPT; Bethany id
  // unchanged so the fuller owner-requested data refreshes in place) ──
  for (const r of [...REAL_MARIN_RESOURCES, ...KEPT_EXISTING_RESOURCES]) {
    await sql()`
      insert into public.resources
        (id, name, category, address, hours, phone, note, lat, lng, verified_at, verified_by)
      values (
        ${uuid5("resource:" + r.id)}, ${r.name}, ${r.category},
        ${r.address}, ${r.hours}, ${r.phone}, ${r.note},
        ${r.lat}, ${r.lng}, ${MARIN_VERIFIED_AT}::date, ${JENN_UUID}
      )
      on conflict (id) do update set
        name = excluded.name,
        category = excluded.category,
        address = excluded.address,
        hours = excluded.hours,
        phone = excluded.phone,
        note = excluded.note,
        lat = excluded.lat,
        lng = excluded.lng,
        verified_at = ${MARIN_VERIFIED_AT}::date,
        verified_by = ${JENN_UUID}`;
  }
  const total = await sql()`select count(*)::int as n from public.resources`;
  console.log(`[resources-real] real resources upserted; total now ${total[0]?.n}`);

  // ── 5. Delete the wave-test + seed-demo needs (report exact deletions) ──
  const del = await sql()`
    delete from public.supply_requests
    where note = 'Wave round-trip test need'
       or note = 'Joe needs a tent at the skatepark'
    returning id, note, status`;
  for (const d of del) console.log(`[resources-real] deleted need ${d.id} (${d.note}, ${d.status})`);
  const openCount = await sql()`
    select count(*)::int as n from public.supply_requests where status = 'open'`;
  console.log(`[resources-real] open needs after cleanup: ${openCount[0]?.n}`);

  process.exit(0);
}

main().catch((e: Error) => {
  console.error("[resources-real] FAILED:", e.message);
  process.exit(1);
});
