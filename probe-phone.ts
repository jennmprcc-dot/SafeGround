import { Pool } from "pg";
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await pool.query(`
create or replace function public.sg_norm_phone(raw text)
returns text language sql immutable set search_path = public
as $sgfn$
  select case
    when length(regexp_replace(coalesce(raw, ''), '[^0-9]', '', 'g')) = 11
         and left(regexp_replace(coalesce(raw, ''), '[^0-9]', '', 'g'), 1) = '1'
    then right(regexp_replace(coalesce(raw, ''), '[^0-9]', '', 'g'), 10)
    else regexp_replace(coalesce(raw, ''), '[^0-9]', '', 'g')
  end
$sgfn$;
`);
const r = await pool.query(
  `select public.sg_norm_phone('4158797940') as a,
          public.sg_norm_phone('14158797940') as b,
          public.sg_norm_phone('415-879-7940') as c,
          public.is_roster_admin('4158797940') as admin10,
          public.is_roster_admin('14158797940') as admin11,
          public.is_roster_staff('4153028367') as staff10,
          public.is_roster_staff('14153028367') as staff11`,
);
console.log(JSON.stringify(r.rows[0]));
await pool.end();