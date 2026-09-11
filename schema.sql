-- ============================================================================
-- SafeGround — Supabase-ready data layer (deliverable artifact, Build A)
-- ============================================================================
-- Tables: users, sweeps, supply_requests, resources, check_ins, trusted_peers,
--         hometeam_members, emergency_alerts, outreach_roster,
--         peer_support_requests, push_tokens
--         (+ HomeTeam columns on supply_requests)
-- Privacy guarantees (PRD §6, R-P1…R-P11) are implemented as row-level
-- security policies, NOT as application conventions:
--   * resources / sweeps:   public anon read (R-P6 — read without fear)
--   * check_ins:            owner writes; peers read ONLY fuzzed columns (R-P4)
--   * everything else:      owner-write only; outreach role for verify/flag/resolve
--   * no background location anywhere: schema stores only user-approved payloads
--
-- Run order: extensions → enums → tables → is_outreach() helper → RLS → indexes
-- ============================================================================

-- Safe extensions only (used for fuzzing + id generation).
create extension if not exists pgcrypto;
-- (If a nearer-geometry extension lands later, keep fuzzing in Postgres,
--  never in the client — exact coords must never leave the server.)

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type sweep_status as enum ('reported', 'verified', 'resolved', 'flagged');
-- Community-reported → outreach-verified (or flagged for review) → resolved/expired.
-- 'flagged' is a review state, never a silent delete (PRD F2 / AC-S5).
create type sweep_severity as enum ('active', 'planned', 'resolved_recent');
-- Map state: Active = happening now / within 24h; Planned = future window;
-- Resolved = passed date + 48h, or outreach marked it resolved.

create type request_status as enum ('open', 'claimed', 'fulfilled', 'cancelled');
create type role_type as enum ('neighbor', 'outreach', 'outreach_admin');

-- ---------------------------------------------------------------------------
-- users (minimal — alias allowed, no legal name; PRD R-P7)
--
-- Mirror of auth.users for app-level roles. Created by trigger on auth signup;
-- outreach provisioning is manual (lead decides), never self-serve.
-- ---------------------------------------------------------------------------
create table public.users (
  id            uuid primary key references auth.users (id) on delete cascade,
  display_name  text not null check (char_length(display_name) between 1 and 40),
  role          role_type not null default 'neighbor',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- resources (public read; outreach write — PRD F1 / R-P6)
-- ---------------------------------------------------------------------------
create table public.resources (
  id            uuid primary key default gen_random_uuid(),
  name          text not null check (char_length(name) between 2 and 120),
  category      text not null check (category in (
                  'food', 'shelter', 'water', 'showers',
                  'clinics', 'charging', 'legal', 'daycenters'
                )),
  address       text,
  hours         text,
  phone         text,
  note          text check (char_length(note) <= 600),          -- "what to expect"
  lat           double precision check (lat between -90 and 90),
  lng           double precision check (lng between -180 and 180),
  verified_at   date,
  verified_by   uuid references public.users (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- sweeps (public read; signed-in report; outreach verify/flag/resolve)
-- ---------------------------------------------------------------------------
create table public.sweeps (
  id                uuid primary key default gen_random_uuid(),
  reported_by       uuid references public.users (id) on delete set null,
  status            sweep_status not null default 'reported',
  severity          sweep_severity not null default 'active',
  -- Window semantics: active within 24h of event_at; planned when event_at is future.
  event_at          timestamptz not null,
  resolved_at       timestamptz,             -- set when outreach marks resolved
  lat               double precision not null check (lat between -90 and 90),
  lng               double precision not null check (lng between -180 and 180),
  note              text check (char_length(note) <= 500),  -- plain text, links stripped
  -- Provenance: community-reported vs outreach-verified (PRD S-3)
  verified_at       timestamptz,
  verified_by       uuid references public.users (id) on delete set null,
  -- Every transition is timestamped + attributed (AC-S5)
  flagged_at        timestamptz,
  flagged_by        uuid references public.users (id) on delete set null,
  created_at        timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- hometeam_members — MPRCC HomeTeam: community supporters (owner-directed
-- 2026-09-06; named for MPRCC's future housing development work).
--
-- Join = in-app "Join the HomeTeam": phone + name + explicit consent timestamp
-- (R-P1). NO account (no auth.users row — R-P6/R-P7), NO location, ever.
-- Supporters claim needs ("I got that"), coordinators assign sensitive needs,
-- and deliveries are recorded (who/what/when). `paused` = opted out: the
-- member's row stays for history but they claim/receive nothing new.
-- Phone is the identity (E.164-normalized by the app before insert).
-- ---------------------------------------------------------------------------
create table public.hometeam_members (
  id                      uuid primary key default gen_random_uuid(),
  phone                   text not null unique check (char_length(phone) between 7 and 20),
  display_name            text not null check (char_length(display_name) between 1 and 40),
  consented_to_contact_at timestamptz not null default now(),
  -- After-hours emergency-alert consent. Default OFF (owner-directed 2026-09-06):
  -- HomeTeam supporters receive emergency alerts only during business hours
  -- (8:00–18:00 Mon–Fri, sender's local time = Marin) UNLESS this is true.
  -- Set when the supporter taps "yes, reach me after hours too" in the join
  -- sheet; the send RPC enforces it IN the audience filter, not at read time.
  consents_to_after_hours boolean not null default false,
  status                  text not null default 'active' check (status in ('active', 'paused')),
  created_at              timestamptz not null default now()
);

-- Forward migration for databases created BEFORE this wave (idempotent).
alter table public.hometeam_members
  add column if not exists consents_to_after_hours boolean not null default false;

-- ---------------------------------------------------------------------------
-- supply_requests (owner + outreach only — queue, Wave 2)
--
-- HomeTeam wave (owner-directed 2026-09-06): the needs loop.
--   * visibility: 'open' = any supporter may tap "I got that";
--     'assign_only' = coordinator assigns a supporter (never self-claimed);
--     'private' = outreach eyes only.
--   * hometeam_claimed_by/assigned_to/delivered_by point at
--     hometeam_members(id) — the supporter who stepped up — NOT at users(id): community supporters join
--     with just a phone + name (R-P6/R-P7), never an account. The legacy
--     claimed_by→users column can NOT be repurposed (users requires an
--     auth.users row); it stays for history. New writes use hometeam_claimed_by.
--   * the legacy request_status enum (open/claimed/fulfilled/cancelled) is
--     widened with 'in_progress' (claimed/assigned, help on the way) and
--     'delivered'; every legacy value keeps working.
-- ---------------------------------------------------------------------------
create table public.supply_requests (
  id                  uuid primary key default gen_random_uuid(),
  requested_by        uuid not null references public.users (id) on delete cascade,
  items               text[] not null default '{}',
  note                text check (char_length(note) <= 400),
  pickup_preference   text check (char_length(pickup_preference) <= 200),
  status              request_status not null default 'open',
  visibility          text not null default 'open'
                      check (visibility in ('open', 'assign_only', 'private')),
  claimed_by          uuid references public.users (id) on delete set null,
  -- HomeTeam supporters (phone-based, no account — see hometeam_members).
  hometeam_claimed_by uuid references public.hometeam_members (id) on delete set null,
  claimed_at          timestamptz,
  assigned_to         uuid references public.hometeam_members (id) on delete set null,
  assigned_at         timestamptz,
  delivered_by        uuid references public.hometeam_members (id) on delete set null,
  delivered_at        timestamptz,
  fulfilled_at        timestamptz,
  cancelled_at        timestamptz,
  created_at          timestamptz not null default now(),
  -- R-P10: anonymized (blurred) after fulfillment +30d.
  -- NOTE: set by the BEFORE INSERT/UPDATE trigger `trg_requests_anonymize`
  -- (a generated column can't express `timestamptz + interval` — Postgres
  -- classifies it `stable`, and generated columns require `immutable`).
  anonymize_at        timestamptz
);

-- Forward migration for databases created BEFORE the HomeTeam wave
-- (apply-schema runs every statement idempotently; ADD COLUMN IF NOT EXISTS
-- and the guarded DO blocks make re-runs no-ops).
alter table public.supply_requests
  add column if not exists visibility text not null default 'open'
    check (visibility in ('open', 'assign_only', 'private'));
alter table public.supply_requests
  add column if not exists hometeam_claimed_by uuid
    references public.hometeam_members (id) on delete set null;
alter table public.supply_requests add column if not exists claimed_at timestamptz;
alter table public.supply_requests
  add column if not exists assigned_to uuid
    references public.hometeam_members (id) on delete set null;
alter table public.supply_requests add column if not exists assigned_at timestamptz;
alter table public.supply_requests
  add column if not exists delivered_by uuid
    references public.hometeam_members (id) on delete set null;
alter table public.supply_requests add column if not exists delivered_at timestamptz;
-- Widen the legacy request_status enum (open/claimed/fulfilled/cancelled) with
-- the HomeTeam lifecycle values. Guarded: re-runs and fresh builds no-op.
do $sgmig$
begin
  if not exists (select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
                 where t.typname = 'request_status' and e.enumlabel = 'in_progress') then
    alter type request_status add value 'in_progress';
  end if;
  if not exists (select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
                 where t.typname = 'request_status' and e.enumlabel = 'delivered') then
    alter type request_status add value 'delivered';
  end if;
end;
$sgmig$;

-- ---------------------------------------------------------------------------
-- check_ins — the privacy-critical table (R-P1, R-P4, R-P5, R-P10)
--
-- Split-point design: the OWNER's exact coordinate lives in exact_lat/exact_lng.
-- Peers NEVER read those columns (RLS below exposes only fuzz_* via a secured
-- view). fuzz_lat/fuzz_lng are rounded to ~150m at insert time on the server.
-- ---------------------------------------------------------------------------
create table public.check_ins (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.users (id) on delete cascade,
  checked_in_at   timestamptz not null default now(),
  -- Exact point: written by the owner, read by the owner + outreach-admin only.
  exact_lat       double precision check (exact_lat between -90 and 90),
  exact_lng       double precision check (exact_lng between -180 and 180),
  -- Peer-facing fuzz: ~150m (≈0.0015°) — "approximate area" copy everywhere.
  fuzz_lat        double precision check (fuzz_lat between -90 and 90),
  fuzz_lng        double precision check (fuzz_lng between -180 and 180),
  note            text check (char_length(note) <= 140),
  -- Visibility: 24h default (R-P10); NULL/share_paused hides instantly (R-P5).
  -- NOTE: set by the BEFORE INSERT trigger `trg_checkins_timestamps`
  -- (a generated column can't express `timestamptz + interval` — Postgres
  -- classifies it `stable`, and generated columns require `immutable`).
  visible_until   timestamptz,
  share_paused    boolean not null default false,
  created_at      timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- trusted_peers — Build B privacy wiring (R-P4)
--
-- The pairing table that answers "who may see my check-ins". The check-in
-- relationship is MUTUAL by design: I can see a peer's check-in only if both
-- of us have each other as trusted peers. This implements the wireframes'
-- phrase "people sharing with you" in both directions, keeps remove-instant
-- and invite-pending from leaking the exact point, and makes "share_paused
-- hides instantly" enforceable in a single policy.
-- ---------------------------------------------------------------------------
create table public.trusted_peers (
  requester_id  uuid not null references public.users (id) on delete cascade,
  peer_id       uuid not null references public.users (id) on delete cascade,
  status        text not null default 'pending'
                check (status in ('pending', 'accepted')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  primary key (requester_id, peer_id),
  check (requester_id <> peer_id)
);

-- ---------------------------------------------------------------------------
-- Triggers — the stable-kind columns + server-side fuzzing (R-P4)
-- ---------------------------------------------------------------------------

-- Requests: anonymize_at = coalesce(delivered, fulfilled, created) + 30 days.
create or replace function public.trg_fn_requests_anonymize()
returns trigger language plpgsql set search_path = public
as $sg$
begin
  new.anonymize_at := coalesce(new.delivered_at, new.fulfilled_at, new.created_at) + interval '30 days';
  return new;
end;
$sg$;

drop trigger if exists trg_requests_anonymize on public.supply_requests;
create trigger trg_requests_anonymize
  before insert or update of delivered_at, fulfilled_at, created_at on public.supply_requests
  for each row execute function public.trg_fn_requests_anonymize();

-- ---------------------------------------------------------------------------
-- emergency_alerts — trusted-peer one-tap alert (owner-directed 2026-09-06;
-- refinements encoded 2026-09-06, plan rev 10)
--
-- The sender picks quick options (Unsafe place / Police nearby / Help needed —
-- never police) + a short note, chooses WHO sees it (friends / peers /
-- HomeTeam supporters), and chooses location: three sender-chosen options per
-- alert — none / fuzzed ~150m / exact — NEVER pre-selected (the send RPC
-- raises unless location_shared is explicitly 'none'|'fuzzed'|'exact').
--
-- Audience rule (R-P8, rev 10): friends + peers ALWAYS get the alert. HomeTeam
-- members get it ONLY during business hours 8:00–18:00 Mon–Fri (Marin local)
-- UNLESS consents_to_after_hours — enforced INSIDE send_emergency_alert by
-- row-filtering the hometeam audience by hour + weekday + consent (not just at
-- read time). "Send-only-above-board": audience must name at least one group —
-- never silently drop to "no one".
--
-- "I'm on it": the first helper in the alert's audience (or a roster member)
-- who claims becomes claimed_by (normalized phone, FK-free) — the ownership
-- path ("who's helping"). The sender clears their own alert ("I'm OK") as the
-- primary path (records resolved_by_role='sender'); outreach staff may clear as
-- a safety override (resolved_by_role='staff') only if a roster member.
-- outcome_note is the staff/sender outcome record (≤1000 chars) — visible to
-- admin + sender only. 24h expiry via trg_alerts_expiry; resolve/expire are
-- the ONLY close paths. NOTHING here contacts 911 or any agency — outreach can
-- VIEW active alerts to help; nothing is auto-dispatched.
-- Identity is phone-based (senders may have no account — R-P6/R-P7).
-- ---------------------------------------------------------------------------
create table public.emergency_alerts (
  id                 uuid primary key default gen_random_uuid(),
  sender_phone       text not null check (char_length(sender_phone) between 7 and 20),
  kind               text not null
                     check (kind in ('unsafe_place', 'police_nearby', 'help_needed')),
  note               text check (char_length(note) <= 500),
  -- Fuzzed ~150m point, supplied by the sender's device with per-alert consent.
  fuzz_lat           double precision check (fuzz_lat between -90 and 90),
  fuzz_lng           double precision check (fuzz_lng between -180 and 180),
  -- Location choice, sender-picked per alert: 'none' | 'fuzzed' | 'exact'.
  -- NEVER pre-selected — the enum default is 'none' and send_emergency_alert
  -- raises if the caller does not pass an explicit value in {none,fuzzed,exact}
  -- (NULL or empty is rejected, never defaulted).
  location_shared    text not null default 'none'
                     check (location_shared in ('none', 'fuzzed', 'exact')),
  exact_lat          double precision check (exact_lat between -90 and 90),
  exact_lng          double precision check (exact_lng between -180 and 180),
  -- Consent record: which groups the sender chose (non-empty subset).
  audience           text[] not null default '{friends,peers,hometeam}'
                     check (audience <@ array['friends', 'peers', 'hometeam']
                       and cardinality(audience) > 0),
  -- "I'm on it" ownership: first claim wins (guarded in sg_claim_alert); the
  -- claiming helper is in the alert's audience OR is a roster member. FK-free
  -- phone (senders/helpers may have no account — R-P6/R-P7).
  claimed_by         text check (char_length(claimed_by) between 7 and 20),
  claimed_at         timestamptz,
  resolved_at        timestamptz,
  resolved_by_phone  text check (char_length(resolved_by_phone) between 7 and 20),
  -- Outcome tracking (rev 10): resolved_by_role 'sender' (I'm OK) or 'staff'
  -- (outreach safety override); outcome_note ≤1000 chars, visible only to
  -- admin + sender (staff_limited can never see it).
  resolved_by_role   text check (resolved_by_role in ('sender', 'staff')),
  outcome_note       text check (char_length(outcome_note) <= 1000),
  -- NOTE: set by the BEFORE INSERT trigger `trg_alerts_expiry` (+24h, R-P10)
  -- (a generated column can't express `timestamptz + interval` — stable kind).
  expires_at         timestamptz,
  created_at         timestamptz not null default now()
);

-- Forward migration for databases created BEFORE this wave (idempotent).
-- Column renames cannot be conditional, so the legacy-shape migration lives in
-- a single guarded DO block: it only fires when the OLD (boolean)
-- location_shared is still present. Fresh builds never have the boolean at
-- all (the create above already defines the text column), so the block is a
-- no-op and leaves no re-run artifacts behind.
alter table public.emergency_alerts add column if not exists exact_lat double precision check (exact_lat between -90 and 90);
alter table public.emergency_alerts add column if not exists exact_lng double precision check (exact_lng between -180 and 180);
-- Migrate legacy boolean location_shared: false -> 'none', true -> 'fuzzed'.
-- (No legacy value can mean 'exact' — exact coordinates were never stored.)
do $sgmig$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'emergency_alerts'
      and column_name = 'location_shared'
      and data_type = 'boolean'
  ) then
    if not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'emergency_alerts'
        and column_name = 'location_shared_v2'
    ) then
      alter table public.emergency_alerts
        add column location_shared_v2 text not null default 'none'
          check (location_shared_v2 in ('none', 'fuzzed', 'exact'));
    end if;
    update public.emergency_alerts set location_shared_v2 =
      case when location_shared then 'fuzzed' else 'none' end
      where location_shared_v2 = 'none';
    alter table public.emergency_alerts drop column location_shared;
    alter table public.emergency_alerts rename column location_shared_v2 to location_shared;
  end if;
end;
$sgmig$;
-- Add the ownership + outcome columns (both shapes of DB; unconditional adds
-- are safe because they're "if not exists").
alter table public.emergency_alerts add column if not exists claimed_by text check (char_length(claimed_by) between 7 and 20);
alter table public.emergency_alerts add column if not exists claimed_at timestamptz;
alter table public.emergency_alerts add column if not exists resolved_by_role text check (resolved_by_role in ('sender', 'staff'));
alter table public.emergency_alerts add column if not exists outcome_note text check (char_length(outcome_note) <= 1000);

-- Alerts: expires_at = created_at + 24h; fuzz NULL unless 'fuzzed'/'exact';
-- exact lat/lng NULL unless 'exact' (server-side — coords never leave the DB
-- beyond the consent level the sender chose).
create or replace function public.trg_fn_alerts_expiry()
returns trigger language plpgsql set search_path = public
as $sg$
begin
  new.expires_at := coalesce(new.created_at, now()) + interval '24 hours';
  if new.location_shared not in ('fuzzed', 'exact') then
    new.fuzz_lat := null;
    new.fuzz_lng := null;
  end if;
  if new.location_shared <> 'exact' then
    new.exact_lat := null;
    new.exact_lng := null;
  end if;
  return new;
end;
$sg$;

drop trigger if exists trg_alerts_expiry on public.emergency_alerts;
create trigger trg_alerts_expiry
  before insert on public.emergency_alerts
  for each row execute function public.trg_fn_alerts_expiry();

-- Check-ins: visible_until = checked_in_at + 24h; fuzz to ~150m if the
-- caller wrote exact coords but no fuzz (Round-half-away-from-zero, and the
-- fuzz is derived from the exact point INSIDE the DB — exact coords never
-- leave the server).
create or replace function public.trg_fn_checkins_timestamps()
returns trigger language plpgsql set search_path = public
as $sg$
begin
  new.visible_until := new.checked_in_at + interval '24 hours';
  if new.fuzz_lat is null and new.exact_lat is not null then
    new.fuzz_lat := round(new.exact_lat * 1000) / 1000;
  end if;
  if new.fuzz_lng is null and new.exact_lng is not null then
    new.fuzz_lng := round(new.exact_lng * 1000) / 1000;
  end if;
  return new;
end;
$sg$;

drop trigger if exists trg_checkins_timestamps on public.check_ins;
create trigger trg_checkins_timestamps
  before insert on public.check_ins
  for each row execute function public.trg_fn_checkins_timestamps();

-- ---------------------------------------------------------------------------
-- Helper: is_outreach() — used by every outreach-gated policy.
-- Role lives in public.users (manual provisioning by the lead).
-- ---------------------------------------------------------------------------
create or replace function public.is_outreach()
returns boolean
language sql stable security definer set search_path = public
as $sgfn$
  select exists (
    select 1 from public.users
    where id = auth.uid() and role in ('outreach', 'outreach_admin')
  );
$sgfn$;

-- ---------------------------------------------------------------------------
-- outreach_roster — the peer-team staff roster (owner-directed 2026-09-06)
--
-- Phone-based like hometeam_members (peer workers live on their phones, may
-- have no auth.account — R-P6/R-P7). `role`: 'admin' sees everything and can
-- set the roster + resolve alerts; 'staff_limited' can read open needs + active
-- alerts + claim/deliver supplies, but CANNOT clear alerts (sg_resolve is
-- restricted to admin + sender), CANNOT set the roster, and CANNOT view
-- outcome analytics (outcome_note is visible to admin + sender only).
-- Readable by all (public select so the app can render "who's on the team"),
-- writable ONLY through sg_outreach_roster_set (admin-only RPC) — no direct
-- INSERT/UPDATE/DELETE policies exist.
-- ---------------------------------------------------------------------------
create table public.outreach_roster (
  phone        text primary key check (char_length(phone) between 7 and 20),
  display_name text not null check (char_length(display_name) between 1 and 40),
  role         text not null default 'staff_limited'
               check (role in ('admin', 'staff_limited')),
  active       boolean not null default true,
  -- Staff PIN lock (owner-directed 2026-09-11): phone alone no longer opens
  -- staff APIs. pin_hash is a pgcrypto bcrypt hash of the staff member's own
  -- 4–6 digit PIN — NEVER the plaintext (PINs are never stored on devices,
  -- never logged, and never readable back). pin_must_set=true forces the
  -- choose-your-PIN screen on their first login; the PIN is set/reset ONLY
  -- with the bootstrap secret SG_SETUP_TOKEN (env var, owner-held).
  pin_hash     text,
  pin_must_set boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

alter table public.outreach_roster enable row level security;
-- Idempotent column adds (bun scripts/apply-schema.ts is the apply path) —
-- safe to re-run on every deploy; existing rows get pin_must_set=true so the
-- whole team goes through first-login pin setup once this ships.
alter table public.outreach_roster
  add column if not exists pin_hash text,
  add column if not exists pin_must_set boolean not null default true;
-- Everyone may read the roster (it's the public "who's on the team" list);
-- writes happen ONLY through the sg_outreach_roster_set RPC (admin-only).
create policy "roster public read"          on public.outreach_roster for select using (true);

-- ---------------------------------------------------------------------------
-- is_roster_admin() / is_roster_staff() — authorization gates for the
-- alert/needs RPCs below and the Wave 2 dashboard. Unlike is_outreach() they
-- do NOT depend on auth.users: peer workers are phone-identified. When a
-- phone-based caller (sender / helper / staff) needs role checks, the RPC
-- passes the caller's own phone and these helpers answer against the roster.
-- ---------------------------------------------------------------------------
create or replace function public.is_roster_admin(p_phone text)
returns boolean language sql stable security definer set search_path = public
as $sgfn$
  select coalesce(bool_or(role = 'admin'), false)
  from public.outreach_roster
  where public.sg_norm_phone(phone) = public.sg_norm_phone(p_phone) and active;
$sgfn$;

create or replace function public.is_roster_staff(p_phone text)
returns boolean language sql stable security definer set search_path = public
as $sgfn$
  select coalesce(bool_or(active), false)
  from public.outreach_roster
  where public.sg_norm_phone(phone) = public.sg_norm_phone(p_phone);
$sgfn$;

-- ---------------------------------------------------------------------------
-- "Who's on the outreach team?" — one helper returning the active roster as
-- (phone, display_name, role). Readable by everyone; grounded in the roster
-- table (always the app's single source of truth — never an RLS trigger on
-- public.users, which phone-identified peer workers can't touch).
-- ---------------------------------------------------------------------------
create or replace view public.outreach_team
with (security_invoker = true) as
select phone, display_name, role
from public.outreach_roster
where active
order by display_name;

-- ---------------------------------------------------------------------------
-- Row-level security — enable on every table, then policies
-- ---------------------------------------------------------------------------
alter table public.users           enable row level security;
alter table public.resources       enable row level security;
alter table public.sweeps          enable row level security;
alter table public.supply_requests enable row level security;
alter table public.check_ins       enable row level security;
alter table public.trusted_peers   enable row level security;
alter table public.hometeam_members enable row level security;
alter table public.emergency_alerts enable row level security;

-- users: own row only (everyone else sees nothing — even existence is private)
create policy "users read own row"               on public.users for select using (auth.uid() = id);
create policy "users update own row"             on public.users for update using (auth.uid() = id);
create policy "outreach admin manages roles"     on public.users for update using (public.is_outreach());

-- resources: everyone reads (R-P6); only outreach writes/updates
create policy "resources public read"            on public.resources for select using (true);
create policy "resources outreach write"         on public.resources for insert with check (public.is_outreach());
create policy "resources outreach update"        on public.resources for update using (public.is_outreach());

-- sweeps: everyone reads (R-P6); signed-in neighbors report; outreach verifies/flags/resolves
create policy "sweeps public read"               on public.sweeps for select using (true);
create policy "sweeps signed-in report"          on public.sweeps for insert
  with check (auth.uid() = reported_by and public.is_outreach() = false or public.is_outreach());
create policy "sweeps outreach act"              on public.sweeps for update using (public.is_outreach());
create policy "sweeps reporter edits own draft"  on public.sweeps for update
  using (auth.uid() = reported_by and status = 'reported');

-- supply_requests: owner reads/writes; outreach reads queue + acts
create policy "supply owner read"                on public.supply_requests for select
  using (auth.uid() = requested_by or public.is_outreach());
create policy "supply owner create"              on public.supply_requests for insert
  with check (auth.uid() = requested_by);
create policy "supply outreach claim/fulfil"     on public.supply_requests for update
  using (public.is_outreach() or auth.uid() = requested_by);

-- trusted_peers: (R-P4) my side is mine to view/update; invites create a
-- pending row for the invitee; and select is gated on BOTH rows being
-- mutually accepted — "people sharing with you" in both directions.
create policy "peers read only mutual accepted"   on public.trusted_peers for select
  using (
    (requester_id = auth.uid() or peer_id = auth.uid())
    and status = 'accepted'
    and exists (
      select 1 from public.trusted_peers opp
      where opp.requester_id = peer_id and opp.peer_id = requester_id
        and opp.status = 'accepted'
    )
  );
create policy "peers invite pending"              on public.trusted_peers for insert
  with check (peer_id = auth.uid() and status = 'pending');
create policy "peers update own side"             on public.trusted_peers for update
  using (requester_id = auth.uid());

-- ---------------------------------------------------------------------------
-- check_ins — the heart of R-P4 / R-P5 / R-P10
--   owner:       full row, including exact point
--   peers:       fuzzed fields ONLY via the peer_check_ins view — exact_lat/
--                exact_lng are deniable columns (no RLS clause returns them
--                to a peer; the view selects only fuzz_*), and only MUTUAL
--                trusted peers (above) see anything at all
--   outreach:    none — outreach needs counts, not coordinates
-- ---------------------------------------------------------------------------
create policy "checkin owner full read"          on public.check_ins for select
  using (auth.uid() = user_id);
create policy "checkin owner insert"             on public.check_ins for insert
  with check (auth.uid() = user_id);

-- Peer visibility is enforcement via a secured view (peers never run SELECT
-- against the table itself). Fuzz columns rounded server-side (trigger), never
-- client-side.
create or replace view public.peer_check_ins
with (security_invoker = true) as
select
  ci.id,
  ci.user_id,
  u.display_name as peer_name,
  ci.fuzz_lat,
  ci.fuzz_lng,
  ci.checked_in_at,
  ci.note,
  ci.visible_until,
  case
    -- R-P10: expired point is "not sharing", never a last location (R-P5)
    when ci.share_paused or ci.visible_until < now() then false
    else true
  end as sharing
from public.check_ins ci
join public.users u on u.id = ci.user_id
where not ci.share_paused
  and ci.visible_until > now();

-- hometeam_members: phone-based, no accounts anywhere (R-P6/R-P7). Writes
-- happen ONLY through the hometeam_join/pause/resume RPCs below (consent join
-- flow), so no direct INSERT/UPDATE/DELETE policies exist — the RPCs run as
-- SECURITY DEFINER and enforce the rules themselves. Reads: outreach sees the
-- active roster (the queue); everyone else sees nothing (not even existence).
create policy "hometeam outreach reads roster"      on public.hometeam_members for select
  using (public.is_outreach());

-- emergency_alerts: active alerts are visible to outreach (they can help —
-- view only, nothing auto-dispatched). The sender's friends/peers/HomeTeam
-- read their own active alerts through the app's server functions, which query
-- as the service role and match sender_phone↔trusted relationships explicitly.
-- No direct anon/authenticated read policies: phone identity has no auth.uid().
create policy "alerts outreach views active"        on public.emergency_alerts for select
  using (public.is_outreach() and resolved_at is null and expires_at > now());
-- Admins (auth.account-based outreach) may also view resolved alerts + outcome
-- notes for MPRCC's reporting (time-to-resolve, who helped). Staff_limited
-- phone identities never read outcome notes — the Wave 2 dashboard gates on
-- is_roster_admin() at the query layer.
create policy "alerts admin views resolved"         on public.emergency_alerts for select
  using (public.is_outreach());

-- Peers see rows ONLY through the mutual trusted-peers relationship. Exact
-- columns are never exposed — the view selects only fuzz_*.
create policy "checkin peer view fuzzed only"     on public.check_ins for select
  using (
    exists (
      select 1
      from public.trusted_peers a
      join public.trusted_peers b
        on b.requester_id = a.peer_id and b.peer_id = a.requester_id
      where a.requester_id = check_ins.user_id
        and a.peer_id = auth.uid()
        and a.status = 'accepted'
        and b.status = 'accepted'
    )
  );

-- ---------------------------------------------------------------------------
-- RPCs — HomeTeam needs loop + emergency alerts (SECURITY DEFINER,
-- consent-first). Phone is the identity everywhere: normalized to digits-only
-- (leading '+' stripped) before any lookup, so "+1…" and "1…" match.
-- Calm, trauma-informed errors: every failure explains gently, blames nothing.
-- ---------------------------------------------------------------------------

-- Normalize a phone to digits (strip spaces, dashes, parens, leading +).
create or replace function public.sg_norm_phone(raw text)
returns text language sql immutable set search_path = public
as $sgfn$
  -- Digits-only, and unify the North-American leading 1: the roster + alerts
  -- store 11-digit (14158797940) while the app sends 10-digit (4158797940).
  -- The canonical stored form is 10-digit; an 11-digit US number keeps its
  -- leading 1 stripped here so every phone-key comparison matches regardless
  -- of which form the caller used. (Owner bug 2026-09-07.)
  select case
    when length(regexp_replace(coalesce(raw, ''), '[^0-9]', '', 'g')) = 11
         and left(regexp_replace(coalesce(raw, ''), '[^0-9]', '', 'g'), 1) = '1'
    then right(regexp_replace(coalesce(raw, ''), '[^0-9]', '', 'g'), 10)
    else regexp_replace(coalesce(raw, ''), '[^0-9]', '', 'g')
  end
$sgfn$;

-- "Join the HomeTeam": name + phone + explicit consent. Idempotent — joining
-- twice with the same phone reactivates + refreshes consent, never duplicates.
create or replace function public.sg_column_exists(p_table text, p_column text)
returns boolean language plpgsql stable security definer set search_path = public
as $sg$
begin
  return exists (select 1 from information_schema.columns
    where table_schema = 'public' and table_name = p_table and column_name = p_column);
end;
$sg$;
-- hometeam_join keeps its 2-arg signature (all existing callers unchanged);
-- the SMS opt-in travels via an optional 3rd arg with a default.
create or replace function public.hometeam_join(p_phone text, p_display_name text, p_sms boolean default null)
returns uuid language plpgsql security definer set search_path = public
as $sg$
declare
  v_phone text := public.sg_norm_phone(p_phone);
  v_name  text := btrim(coalesce(p_display_name, ''));
  v_id    uuid;
begin
  if char_length(v_phone) < 7 or char_length(v_phone) > 15 then
    raise exception 'That phone number looks incomplete — please check it and try again, no rush.';
  end if;
  if char_length(v_name) < 1 or char_length(v_name) > 40 then
    raise exception 'Please share the name you would like us to use (1–40 characters).';
  end if;
  if public.sg_column_exists('hometeam_members', 'sms_consent') then
    execute format('insert into public.hometeam_members (phone, display_name, consented_to_contact_at, status, sms_consent)'
                   ' values (%L, %L, now(), ''active'', %s)'
                   ' on conflict (phone) do update'
                   ' set display_name = excluded.display_name,'
                   ' consented_to_contact_at = now(),'
                   ' status = ''active'','
                   ' sms_consent = case when %s then true else public.hometeam_members.sms_consent end'
                   ' returning id', v_phone, v_name,
                   case when coalesce(p_sms, false) then 'true' else 'false' end,
                   case when coalesce(p_sms, false) then 'true' else 'false' end)
    into v_id;
  else
    insert into public.hometeam_members (phone, display_name, consented_to_contact_at, status)
    values (v_phone, v_name, now(), 'active')
    on conflict (phone) do update
      set display_name = excluded.display_name,
          consented_to_contact_at = now(),
          status = 'active'
    returning id into v_id;
  end if;
  return v_id;
end;
$sg$;

-- Opt out: paused members keep history but claim/receive nothing new.
create or replace function public.hometeam_pause(p_phone text)
returns boolean language plpgsql security definer set search_path = public
as $sg$
declare
  v_phone text := public.sg_norm_phone(p_phone);
begin
  update public.hometeam_members set status = 'paused' where phone = v_phone;
  if not found then
    raise exception 'We could not find that number on the HomeTeam — nothing was changed.';
  end if;
  return true;
end;
$sg$;

-- Opt back in (re-consent timestamped).
create or replace function public.hometeam_resume(p_phone text)
returns boolean language plpgsql security definer set search_path = public
as $sg$
declare
  v_phone text := public.sg_norm_phone(p_phone);
begin
  update public.hometeam_members
  set status = 'active', consented_to_contact_at = now()
  where phone = v_phone;
  if not found then
    raise exception 'We could not find that number on the HomeTeam — nothing was changed.';
  end if;
  return true;
end;
$sg$;

-- "I got that": an ACTIVE supporter claims an OPEN, pending need.
create or replace function public.hometeam_claim(p_request_id uuid, p_phone text)
returns boolean language plpgsql security definer set search_path = public
as $sg$
declare
  v_phone text := public.sg_norm_phone(p_phone);
  v_mid   uuid;
begin
  select id into v_mid from public.hometeam_members
  where phone = v_phone and status = 'active';
  if v_mid is null then
    raise exception 'Only active HomeTeam supporters can claim a need — join first, when you are ready.';
  end if;
  update public.supply_requests
  set hometeam_claimed_by = v_mid, claimed_at = now(), status = 'in_progress'
  where id = p_request_id
    and status = 'open'
    and visibility = 'open'
    and hometeam_claimed_by is null
    and assigned_to is null;
  if not found then
    raise exception 'That need is already being handled, or is assigned privately — thank you for checking.';
  end if;
  return true;
end;
$sg$;

-- Coordinator assigns a supporter ("Jane, you've got it"). Works for open and
-- assign_only needs; private needs stay outreach-only.
create or replace function public.hometeam_assign(p_request_id uuid, p_phone text)
returns boolean language plpgsql security definer set search_path = public
as $sg$
declare
  v_phone text := public.sg_norm_phone(p_phone);
  v_mid   uuid;
begin
  if not public.is_outreach() then
    raise exception 'Only the outreach team can assign needs — supporters can still claim open needs.';
  end if;
  select id into v_mid from public.hometeam_members
  where phone = v_phone and status = 'active';
  if v_mid is null then
    raise exception 'That supporter is not active on the HomeTeam right now.';
  end if;
  update public.supply_requests
  set assigned_to = v_mid, assigned_at = now(), status = 'in_progress'
  where id = p_request_id
    and status in ('open', 'claimed')
    and visibility in ('open', 'assign_only');
  if not found then
    raise exception 'That need cannot be assigned in its current state — nothing was changed.';
  end if;
  return true;
end;
$sg$;

-- Delivery recorded: who brought what, when. Help is complete — gently.
create or replace function public.hometeam_complete(p_request_id uuid, p_phone text)
returns boolean language plpgsql security definer set search_path = public
as $sg$
declare
  v_phone text := public.sg_norm_phone(p_phone);
  v_mid   uuid;
begin
  select id into v_mid from public.hometeam_members where phone = v_phone;
  if v_mid is null then
    raise exception 'We could not find that supporter — nothing was changed.';
  end if;
  update public.supply_requests
  set delivered_by = v_mid, delivered_at = now(),
      fulfilled_at = coalesce(fulfilled_at, now()), status = 'delivered'
  where id = p_request_id
    and status in ('open', 'claimed', 'in_progress');
  if not found then
    raise exception 'That need is already complete or was cancelled — nothing was changed.';
  end if;
  return true;
end;
$sg$;

-- One-tap emergency alert (owner-directed plan rev 10).
--
-- * Audience is the sender's explicit per-alert choice (friends / peers /
--   hometeam subset — stored as the consent record) and must name at least one
--   group: "send-only-above-board", never silently drop to no one.
-- * HomeTeam members receive alerts ONLY during business hours (8:00–18:00
--   Mon–Fri, the sender's locality = Marin; enforced here in local wall-clock
--   time, not server timezone) UNLESS consents_to_after_hours — the audience
--   stored is exactly the deliverable set: hometeam is dropped from the row
--   when the consent rule excludes every supporter. (friends/peers always stay.)
-- * Location is NEVER pre-selected: p_location_shared must be explicitly one
--   of 'none'|'fuzzed'|'exact'; NULL/empty is rejected with a clear error.
--   'fuzzed' stores the fuzz point only; 'exact' stores the exact point only.
-- * NEVER contacts 911 or any agency — this writes one row for the sender's
--   own chosen people + the outreach team to see.
create or replace function public.send_emergency_alert(
  p_sender_phone text, p_kind text, p_note text,
  p_fuzz_lat double precision, p_fuzz_lng double precision,
  p_location_shared text, p_audience text[],
  p_exact_lat double precision default null,
  p_exact_lng double precision default null
)
returns uuid language plpgsql security definer set search_path = public
as $sg$
declare
  v_phone text := public.sg_norm_phone(p_sender_phone);
  v_aud   text[];
  v_loc   text;
  v_id    uuid;
  v_local timestamp := now() at time zone 'America/Los_Angeles';
begin
  if char_length(v_phone) < 7 or char_length(v_phone) > 15 then
    raise exception 'That phone number looks incomplete — please check it and try again, no rush.';
  end if;
  if p_kind not in ('unsafe_place', 'police_nearby', 'help_needed') then
    raise exception 'Please choose what kind of help this is — Unsafe place, Police nearby, or Help needed.';
  end if;
  if p_note is not null and char_length(p_note) > 500 then
    raise exception 'Please keep the note under 500 characters so it stays quick to read.';
  end if;
  -- Location: explicitly provided, never defaulted (rev 10).
  v_loc := btrim(coalesce(p_location_shared, ''));
  if v_loc not in ('none', 'fuzzed', 'exact') then
    raise exception 'Please choose how much location to share — none, an approximate area, or the exact spot.';
  end if;
  if v_loc = 'fuzzed' and (p_fuzz_lat is null or p_fuzz_lng is null
     or p_fuzz_lat not between -90 and 90 or p_fuzz_lng not between -180 and 180) then
    raise exception 'Sharing an approximate area needs those coordinates — or send without location, that is always okay.';
  end if;
  if v_loc = 'exact' and (p_exact_lat is null or p_exact_lng is null
     or p_exact_lat not between -90 and 90 or p_exact_lng not between -180 and 180) then
    raise exception 'The exact spot needs its coordinates — or share an approximate area instead.';
  end if;
  -- Audience: at least one group, explicit (rev 10 "send-only-above-board").
  v_aud := coalesce(p_audience, array[]::text[]);
  if cardinality(v_aud) = 0 or not (v_aud <@ array['friends', 'peers', 'hometeam']) then
    raise exception 'Please choose at least one group to share this with — friends, peers, or HomeTeam.';
  end if;
  -- Business-hours rule for the HomeTeam audience (rev 10, enforced here):
  -- hometeam is kept only when at least one ACTIVE supporter will actually
  -- receive it during business hours (8:00–18:00 Mon–Fri local) or has
  -- consents_to_after_hours. Everyone else in {friends,peers} is kept as-is.
  if coalesce(array_position(v_aud, 'hometeam'), 0) > 0
     and not exists (
       select 1 from public.hometeam_members hm
       where hm.status = 'active'
         and (hm.consents_to_after_hours
              or (extract(dow from v_local) between 1 and 5
                  and extract(hour from v_local) >= 8
                  and extract(hour from v_local) < 18))
     ) then
    v_aud := array_remove(v_aud, 'hometeam');
  end if;
  -- Send-only-above-board (rev 10): never drop to "no one". If the business-
  -- hours rule emptied the audience, reject with a gentle explanation instead
  -- of silently creating an alert that reaches nobody.
  if cardinality(v_aud) = 0 then
    raise exception 'Right now that choice would reach no one — HomeTeam supporters only get alerts during business hours (8am–6pm weekdays) unless they opt in for after-hours.';
  end if;
  insert into public.emergency_alerts
    (sender_phone, kind, note, fuzz_lat, fuzz_lng,
     location_shared, exact_lat, exact_lng, audience)
  values (v_phone, p_kind, nullif(btrim(coalesce(p_note, '')), ''),
          case when v_loc = 'fuzzed' then p_fuzz_lat end,
          case when v_loc = 'fuzzed' then p_fuzz_lng end,
          v_loc,
          case when v_loc = 'exact' then p_exact_lat end,
          case when v_loc = 'exact' then p_exact_lng end,
          v_aud)
  returning id into v_id;
  return v_id;
end;
$sg$;

-- "I'm on it" — helper ownership of an alert. First claim wins; the claimant
-- must be able to receive the alert in the first place: an active roster
-- member (the peer team) OR an active HomeTeam supporter when the audience
-- includes hometeam. (friends/peers are phone-identified with no phone→
-- relationship table yet — the peer team is the trusted network for those.)
-- Re-claims by the same phone are idempotent — they return the current state
-- (no error). A stranger's claim attempts resolve to the current (null) state
-- silently — no leak, no error noise.
create or replace function public.sg_claim_alert(p_alert_id uuid, p_helper_phone text)
returns table (claimed_by text, claimed_at timestamptz)
language plpgsql security definer set search_path = public
as $sg$
declare
  v_phone text := public.sg_norm_phone(p_helper_phone);
begin
  if char_length(v_phone) < 7 or char_length(v_phone) > 15 then
    raise exception 'That phone number looks incomplete — please check it and try again, no rush.';
  end if;
  -- First claim wins; claimants must be able to receive the alert.
  update public.emergency_alerts
  set claimed_by = v_phone, claimed_at = now()
  where id = p_alert_id
    and resolved_at is null
    and claimed_by is null
    and (
      public.is_roster_staff(v_phone)
      or ('hometeam' = any(audience) and exists (
            select 1 from public.hometeam_members hm
            where hm.phone = v_phone and hm.status = 'active'))
    );
  if not found then
    return query
      select ea.claimed_by, ea.claimed_at
      from public.emergency_alerts ea
      where ea.id = p_alert_id;
    return;
  end if;
  return query
    select ea.claimed_by, ea.claimed_at
    from public.emergency_alerts ea
    where ea.id = p_alert_id;
end;
$sg$;

-- "I'm OK": the sender resolves their own alert (records resolved_by_role =
-- 'sender', with an optional reason/outcome note — the sender's own words);
-- outreach staff (admin) may resolve as a safety override when the sender
-- can't, with an outcome note (resolved_by_role = 'staff').
create or replace function public.resolve_emergency_alert(
  p_alert_id uuid, p_phone text,
  p_outcome_note text default null
)
returns boolean language plpgsql security definer set search_path = public
as $sg$
declare
  v_phone text := public.sg_norm_phone(p_phone);
  v_note  text := btrim(coalesce(p_outcome_note, ''));
begin
  -- Sender path ("I'm OK"): records role + optional reason.
  update public.emergency_alerts
  set resolved_at = now(), resolved_by_phone = v_phone,
      resolved_by_role = 'sender',
      outcome_note = case when char_length(v_note) > 0 then v_note else outcome_note end
  where id = p_alert_id
    and sender_phone = v_phone
    and resolved_at is null;
  if found then return true; end if;

  -- Safety override: only roster admins. outcome_note is the staff record.
  if public.is_roster_admin(v_phone) then
    update public.emergency_alerts
    set resolved_at = now(), resolved_by_phone = v_phone,
        resolved_by_role = 'staff',
        outcome_note = case when char_length(v_note) > 0 then v_note else outcome_note end
    where id = p_alert_id
      and resolved_at is null;
    if found then return true; end if;
  end if;

  raise exception 'That alert is already resolved, or was not sent from this number — and only outreach staff can clear someone else''s alert.';
end;
$sg$;

-- Admin-only roster writer: upsert a peer-team member into outreach_roster
-- (phone normalized; role admin|staff_limited; active toggle). Phone identity
-- has no auth session in this app, so the admin gate is the roster itself: the
-- phone passed must be an ACTIVE roster admin (their own record — self-upsert).
-- Staff_limited callers are rejected. The initial roster is provisioned by the
-- lead's seed (direct service-role inserts), and admins manage their own row
-- in-app afterwards — chicken-and-egg safe: no one can promote themselves.
create or replace function public.sg_outreach_roster_set(
  p_phone text, p_display_name text, p_role text, p_active boolean
)
returns boolean language plpgsql security definer set search_path = public
as $sg$
declare
  v_phone text := public.sg_norm_phone(p_phone);
  v_name  text := btrim(coalesce(p_display_name, ''));
begin
  if not public.is_roster_admin(v_phone) then
    raise exception 'Only an outreach admin can manage the team roster.';
  end if;
  if char_length(v_phone) < 7 or char_length(v_phone) > 15 then
    raise exception 'That phone number looks incomplete — please check it and try again, no rush.';
  end if;
  if char_length(v_name) < 1 or char_length(v_name) > 40 then
    raise exception 'Please use a name of 1–40 characters.';
  end if;
  if p_role not in ('admin', 'staff_limited') then
    raise exception 'Roster roles are admin or staff_limited.';
  end if;
  insert into public.outreach_roster (phone, display_name, role, active, updated_at)
  values (v_phone, v_name, p_role, coalesce(p_active, true), now())
  on conflict (phone) do update
    set display_name = excluded.display_name,
        role = excluded.role,
        active = excluded.active,
        updated_at = now();
  return true;
end;
$sg$;

-- ---------------------------------------------------------------------------
-- Indexes (query paths that matter for the MVP plus the 24h TTL cleanup)
-- ---------------------------------------------------------------------------
create index idx_resources_category      on public.resources (category);
create index idx_resources_open_lat_lng  on public.resources (lat, lng);
create index idx_sweeps_status_severity  on public.sweeps (status, severity);
create index idx_sweeps_event_at         on public.sweeps (event_at);
create index idx_requests_status         on public.supply_requests (status);
create index idx_checkins_user_time      on public.check_ins (user_id, checked_in_at desc);
create index idx_checkins_expiry         on public.check_ins (visible_until);
create index idx_peers_requester         on public.trusted_peers (requester_id, peer_id);
create index idx_peers_peer              on public.trusted_peers (peer_id, requester_id);
create index idx_hometeam_phone           on public.hometeam_members (phone);
create index idx_hometeam_status          on public.hometeam_members (status);
create index idx_requests_visibility      on public.supply_requests (visibility, status);
create index idx_alerts_active            on public.emergency_alerts (resolved_at, expires_at);
create index idx_alerts_sender            on public.emergency_alerts (sender_phone, created_at desc);
create index idx_alerts_claim             on public.emergency_alerts (claimed_by, claimed_at);
create index idx_roster_role              on public.outreach_roster (role, active);

-- ---------------------------------------------------------------------------
-- Comments — the privacy contract, in the schema itself
-- ---------------------------------------------------------------------------
comment on table public.check_ins is
  'Check-in points. exact_lat/exact_lng are owner-and-outreach-admin only (R-P4); '
  'peers read peer_check_ins with fuzzed ~150m coords and a visible_until of 24h (R-P10). '
  'share_paused hides a point instantly (R-P5). No background location exists in this app.';
comment on column public.check_ins.fuzz_lat is
  'Peer-facing latitude, rounded to ~150m at insert (R-P4). Never exact.';
comment on column public.check_ins.fuzz_lng is
  'Peer-facing longitude, rounded to ~150m at insert (R-P4). Never exact.';
comment on column public.check_ins.exact_lat is
  'Exact latitude — readable only by the owner and outreach-admin. Never returned to peers.';
comment on table public.sweeps is
  'Sweep heads-ups. Public read (R-P6). reported→verified|flagged→resolved lifecycle (F2); '
  'flagged is a review state, never a silent delete (AC-S5).';
comment on table public.resources is
  'Resource listings. Public read (R-P6); outreach maintains verified_at freshness (AC-N4).';
comment on table public.supply_requests is
  'Supply requests + the HomeTeam needs loop (owner-directed 2026-09-06). pending→in_progress→delivered; '
  'visibility open = supporters may claim ("I got that"), assign_only = coordinator assigns, private = outreach only. '
  'Anonymized +30d after delivery/fulfilment (R-P10).';
comment on table public.hometeam_members is
  'HomeTeam community supporters (no account, no location — R-P6/R-P7). '
  'Join = phone + name + explicit consent (R-P1); paused = opted out. '
  'consents_to_after_hours (default OFF) opts in to emergency alerts outside '
  '8:00–18:00 Mon–Fri. Phone is the identity (digits-normalized). Named for '
  'MPRCC''s future housing development work.';
comment on table public.emergency_alerts is
  'Trusted-peer one-tap alerts: quick kind + note, sender-chosen audience '
  '(friends/peers/hometeam), location never pre-selected — none/fuzzed~150m/'
  'exact (rev 10). HomeTeam receives alerts only in business hours unless '
  'consents_to_after_hours. "I''m on it" first-claim ownership; "I''m OK" '
  'resolves; staff override records an outcome note; 24h expiry (R-P10). '
  'NEVER contacts 911 or any agency — outreach views active alerts to help; '
  'nothing auto-dispatched.';
comment on table public.outreach_roster is
  'MPRCC peer-team roster (phone identity, R-P6/R-P7). admin = full visibility '
  'incl. outcome notes + can resolve alerts (safety override) + manage roster; '
  'staff_limited = open needs + active alerts + claim/deliver — never clears '
  'alerts, never sets roster, never sees outcome analytics. Writes only via '
  'sg_outreach_roster_set (admin-only); reads are public.';
comment on function public.is_outreach() is
  'Role gate used by outreach policies. Roles are provisioned manually by the lead; never self-serve.';
-- ---------------------------------------------------------------------------
-- push_tokens — Firebase web-push registration storage (owner green-lit 2026-09-06)
--
-- One row per (phone, device token). Phone is the sg_norm_phone-digit identity
-- used everywhere in this app; token is the FCM registration token the browser
-- receives after the user taps "Allow". Storing it server-side is what lets
-- MPRCC staff send the peer-support-request push to the two admins and let
-- the owner test notifications end-to-end. RLS: create/select/update are
-- confined to the row's own phone (the app is phone-identified, no session);
-- the server send route reads tokens service-side, never through the
-- anon-key REST API. deleting a row = revoking push for that device forever;
-- the send route ignores unregistered/missing tokens (FCM returns
-- UNREGISTERED on a stale one, and attachToRegistered+send treats it as absent).
-- ---------------------------------------------------------------------------
create table public.push_tokens (
  phone        text not null check (char_length(phone) between 7 and 20),
  token        text not null check (char_length(token) between 20 and 512),
  device_label text check (device_label is null or char_length(device_label) between 1 and 60),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  primary key (phone, token)
);
alter table public.push_tokens enable row level security;
-- The token is the device proof for its OWNER only: anyone may insert their
-- own token (phone-identified, matching the row's phone), select/update rows
-- whose phone is their own — never another phone's tokens, never the anon
-- role reading all tokens. Staff sends happen service-side (server role).
create policy "push tokens own insert" on public.push_tokens for insert
  with check (phone = current_setting('request.headers', true)::json ->> 'x-sg-phone');
create policy "push tokens own select" on public.push_tokens for select
  using (phone = current_setting('request.headers', true)::json ->> 'x-sg-phone');
create policy "push tokens own update" on public.push_tokens for update
  using (phone = current_setting('request.headers', true)::json ->> 'x-sg-phone');
create policy "push tokens owner delete" on public.push_tokens for delete
  using (phone = current_setting('request.headers', true)::json ->> 'x-sg-phone');
create index idx_push_tokens_phone on public.push_tokens (phone, updated_at desc);
comment on table public.push_tokens is
  'Firebase web-push tokens (phone identity). One row per (phone, token); '
  'phone-bound RLS: a row is only ever visible/writable to the phone it '
  'belongs to. No background location, no SMS, no auto-contact — push is the '
  'dispatch channel ONLY for consenting parties and the owner test button '
  '(owner-directed 2026-09-06).';

-- ---------------------------------------------------------------------------
-- peer_support_requests — one-tap "Request peer support" (owner-directed 2026-09-06)
--
-- A neighbor taps once; the row is the queue. The server then pushes a Firebase
-- notification to MPRCC's two roster admins ONLY (PEER_SUPPORT_ADMIN_PHONES in
-- src/lib/pushServer.ts — Jenn + Bambi) via the tokens in push_tokens. Never
-- 911, never any agency, never SMS. Admin sends are not business-hours-gated
-- (admins are on call); any future HomeTeam-facing notice would be.
--
-- Consent-first: the request itself is the opt-in (user taps the button); only
-- devices that registered a push token (push_tokens) ever receive anything.
-- The requester's own phone is never auto-pushed by this path.
--
-- Status: 'open' → 'claimed' (an admin says "I'm on it") → 'done' | 'closed'.
-- claimed_by_phone / delegate_to_phone / outcome_note mirror the emergency-alert
-- ownership path so Wave 2c reporting can reuse the same shape.
-- ---------------------------------------------------------------------------
create table if not exists public.peer_support_requests (
  id               uuid primary key default gen_random_uuid(),
  phone            text not null check (char_length(phone) between 7 and 20),
  name_optional    text check (name_optional is null or char_length(name_optional) between 1 and 40),
  note             text check (note is null or char_length(note) <= 500),
  status           text not null default 'open'
                   check (status in ('open', 'claimed', 'done', 'closed')),
  claimed_by_phone text check (claimed_by_phone is null or char_length(claimed_by_phone) between 7 and 20),
  delegate_to_phone text check (delegate_to_phone is null or char_length(delegate_to_phone) between 7 and 20),
  outcome_note     text check (outcome_note is null or char_length(outcome_note) <= 500),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
alter table public.peer_support_requests enable row level security;
-- Phone-bound RLS, same pattern as push_tokens: the requester owns their rows
-- (insert own; select/update own). Server routes read/write service-side (the
-- admin queue lists/filters through the server role); nothing anonymous reads
-- another phone's requests.
drop policy if exists "peer support own insert" on public.peer_support_requests;
create policy "peer support own insert" on public.peer_support_requests for insert
  with check (phone = current_setting('request.headers', true)::json ->> 'x-sg-phone');
drop policy if exists "peer support own select" on public.peer_support_requests;
create policy "peer support own select" on public.peer_support_requests for select
  using (phone = current_setting('request.headers', true)::json ->> 'x-sg-phone');
drop policy if exists "peer support own update" on public.peer_support_requests;
create policy "peer support own update" on public.peer_support_requests for update
  using (phone = current_setting('request.headers', true)::json ->> 'x-sg-phone');
create index if not exists idx_peer_support_status on public.peer_support_requests (status, created_at desc);
create index if not exists idx_peer_support_phone on public.peer_support_requests (phone, created_at desc);
-- Urgent-need action (owner-directed 2026-09-08): urgent needs (help /
-- advocacy / ER ride / support) ride the SAME peer_support_requests queue and
-- the SAME admin push path. Never a parallel system, never peers, never 911.
-- is_urgent flags the row; need_category holds the owner-listed category;
-- location (+ coords) is the sender's explicit choice, never pre-selected;
-- exact coords are cleared when the request is done (exact expires with it).
alter table public.peer_support_requests add column if not exists is_urgent boolean not null default false;
alter table public.peer_support_requests add column if not exists need_category text;
alter table public.peer_support_requests add column if not exists location text;
alter table public.peer_support_requests add column if not exists fuzz_lat double precision;
alter table public.peer_support_requests add column if not exists fuzz_lng double precision;
alter table public.peer_support_requests add column if not exists exact_lat double precision;
alter table public.peer_support_requests add column if not exists exact_lng double precision;
alter table public.peer_support_requests add column if not exists expires_at timestamptz;
create index if not exists idx_peer_support_urgent on public.peer_support_requests (is_urgent, status, created_at desc);
comment on table public.peer_support_requests is
  'One-tap peer-support requests (phone identity). Queue persists server-side; '
  'admin push goes ONLY to the two roster admins via push_tokens (never 911, '
  'never SMS). Phone-bound RLS like push_tokens/trusted_peers.';
-- ---------------------------------------------------------------------------
-- Community directory + group notices (owner-directed 2026-09-06)
--
-- Staff-gated roster (Jenn + Bambi admin, Tracey staff_limited) + opt-in
-- group notices via Firebase push ONLY. Never SMS, never auto-contact, never
-- to paused/unconsented numbers. Business-hours rule (8am-6pm Mon-Fri
-- America/Los_Angeles) computed SERVER-side at send time; staff recipients
-- are on-call and never hours-gated.
--
-- Enforcement lives in the RPCs below (same style as hometeam_* + Wave 2c):
--   * sg_directory_list  — admin full rows; staff_limited REDACTED rows
--                          (names + kind + active/paused ONLY — zero phone
--                          digits, zero timestamps, zero after-hours flags);
--                          non-roster raises.
--   * sg_notice_consents — self-service consent upsert (own phone only,
--                          called by the consent API route after calm checks).
--   * sg_notice_eligible — pre-send eligibility counts for the confirm screen.
--   * sg_send_group_notice — admin-only send: validate, compute eligible set,
--                          raise on empty, write the group_notices log row,
--                          return notice_id + recipient phones for fan-out.
--   * sg_notice_history  — admin-only log, newest-first; limited raises.
-- Fan-out itself (sendFcmMessage per token) happens in the API route layer
-- (src/routes/api/directory/*), which reads tokens via push_tokens service
-- role — the directory RPC never exposes push_tokens.token to any client.
-- ---------------------------------------------------------------------------
create table if not exists public.group_notices (
  id                   uuid primary key default gen_random_uuid(),
  sent_by_phone        text not null check (char_length(sent_by_phone) between 7 and 20),
  title                text not null check (char_length(title) between 1 and 80),
  body                 text not null check (char_length(body) between 1 and 500),
  audience             text not null check (audience in ('hometeam', 'neighbors', 'both')),
  eligible_count       int not null default 0 check (eligible_count >= 0),
  sent_count           int not null default 0 check (sent_count >= 0),
  skipped_after_hours  int not null default 0 check (skipped_after_hours >= 0),
  skipped_no_token     int not null default 0 check (skipped_no_token >= 0),
  created_at           timestamptz not null default now()
);
alter table public.group_notices enable row level security;
-- RPC-only: no direct client read/write policies (same pattern as the
-- emergency-alert log — all access through the SECURITY DEFINER RPCs above).
-- ---------------------------------------------------------------------------
-- notice_consents — neighbor opt-in for group updates (owner-directed).
--
-- Neighbors (non-HomeTeam phone contacts: alert senders, peer-support
-- requesters, push registrants) are messaged ONLY with an explicit row here.
-- Collected in-app via checkbox on the alert-sent + peer-support success
-- screens: "MPRCC can send me group updates by app notification" + an
-- after-hours sub-checkbox (default OFF). No row = no notices, ever.
-- ---------------------------------------------------------------------------
create table if not exists public.notice_consents (
  phone                   text primary key check (char_length(phone) between 7 and 20),
  consented_at            timestamptz not null default now(),
  consents_to_after_hours boolean not null default false,
  source                  text check (source is null or char_length(source) between 1 and 40),
  created_at              timestamptz not null default now()
);
alter table public.notice_consents enable row level security;
-- Phone-bound RLS, same pattern as push_tokens: a phone owns its own row
-- (insert/select/update own). Server routes read service-side for the
-- directory + eligibility; nothing anonymous reads another phone's consent.
drop policy if exists "notice consents own insert" on public.notice_consents;
create policy "notice consents own insert" on public.notice_consents for insert
  with check (phone = current_setting('request.headers', true)::json ->> 'x-sg-phone');
drop policy if exists "notice consents own select" on public.notice_consents;
create policy "notice consents own select" on public.notice_consents for select
  using (phone = current_setting('request.headers', true)::json ->> 'x-sg-phone');
drop policy if exists "notice consents own update" on public.notice_consents;
create policy "notice consents own update" on public.notice_consents for update
  using (phone = current_setting('request.headers', true)::json ->> 'x-sg-phone');
create index if not exists idx_notice_consents_after_hours on public.notice_consents (consents_to_after_hours);
comment on table public.notice_consents is
  'Neighbor opt-in for group notices (phone identity). No row = no notices, '
  'ever. Phone-bound RLS like push_tokens; staff reads go through the '
  'SECURITY DEFINER directory RPCs.';
-- ---------------------------------------------------------------------------
-- Shared eligibility core: which phones would receive a notice for an audience
-- at Marin-local now. Returns one row per eligible phone:
--   phone, display_name, after_hours_ok, has_token, skipped_after_hours
-- skipped_after_hours rows are INCLUDED in the set (flagged true) so the
-- confirm screen can count them transparently; they are EXCLUDED from push.
-- ---------------------------------------------------------------------------
create or replace function public.sg_notice_recipients(p_audience text)
returns table (
  phone text,
  display_name text,
  after_hours_ok boolean,
  has_token boolean,
  skipped_after_hours boolean
)
language plpgsql stable security definer set search_path = public
as $sg$
declare
  v_aud text := btrim(coalesce(p_audience, ''));
  v_local timestamp := now() at time zone 'America/Los_Angeles';
  v_in_hours boolean;
begin
  if v_aud not in ('hometeam', 'neighbors', 'both') then
    raise exception 'Please choose who this notice is for — HomeTeam, neighbors, or both.';
  end if;
  v_in_hours := extract(dow from v_local) between 1 and 5
    and extract(hour from v_local) >= 8
    and extract(hour from v_local) < 18;
  return query
  -- HomeTeam side: active supporters only (paused = opted out).
  select
    hm.phone,
    hm.display_name,
    hm.consents_to_after_hours,
    exists (select 1 from public.push_tokens pt where pt.phone = hm.phone),
    (not hm.consents_to_after_hours and not v_in_hours)
  from public.hometeam_members hm
  where (v_aud = 'hometeam' or v_aud = 'both')
    and hm.status = 'active'
  union all
  -- Neighbor side: ONLY explicit notice_consents rows (no row = no notices).
  -- Staff roster phones are on-call admins, never hours-gated — but they are
  -- NOT notice recipients here (admins see the queue in-app); the hours gate
  -- applies to HomeTeam + neighbor recipients per the spec.
  select
    nc.phone,
    'A neighbor',
    nc.consents_to_after_hours,
    exists (select 1 from public.push_tokens pt where pt.phone = nc.phone),
    (not nc.consents_to_after_hours and not v_in_hours)
  from public.notice_consents nc
  where (v_aud = 'neighbors' or v_aud = 'both')
    -- Never double-count a HomeTeam member on a 'both' send.
    and not exists (
      select 1 from public.hometeam_members hm where hm.phone = nc.phone
    );
end;
$sg$;
-- ---------------------------------------------------------------------------
-- sg_directory_list(p_caller_phone): the community roster, role-split.
--
-- Admin → full rows: phone (digits), display_name, kind, active/paused,
-- opted-in flags, consents_to_after_hours, last_active (latest push-token
-- touch or consent touch). Unconsented neighbors show with a "not opted in"
-- flag and are never selectable for messaging.
-- staff_limited → REDACTED rows: display_name + kind + active/paused ONLY.
-- No phone field, no timestamps, no after-hours flags — the client never
-- filters phones out itself; QA asserts the payload has zero phone digits.
-- Non-roster → raises the calm line (never counts, never hints).
-- ---------------------------------------------------------------------------
create or replace function public.sg_directory_list(p_caller_phone text)
returns jsonb
language plpgsql stable security definer set search_path = public
as $sg$
declare
  v_caller text := public.sg_norm_phone(p_caller_phone);
  v_admin boolean := public.is_roster_admin(v_caller);
  v_staff boolean := public.is_roster_staff(v_caller);
  v_full jsonb;
  v_redacted jsonb;
begin
  if not v_staff then
    raise exception 'This space is for the outreach team.';
  end if;
  if v_admin then
    select coalesce(jsonb_agg(row_to_json(t) order by t.display_name), '[]'::jsonb)
    into v_full
    from (
      select
        hm.phone as phone,
        hm.display_name as display_name,
        'hometeam' as kind,
        hm.status = 'active' as active,
        true as opted_in,
        hm.consents_to_after_hours as consents_to_after_hours,
        to_char(hm.consented_to_contact_at, 'YYYY-MM-DD"T"HH24:MI:SSOF') as opted_in_at,
        (select to_char(max(pt.updated_at), 'YYYY-MM-DD"T"HH24:MI:SSOF')
         from public.push_tokens pt where pt.phone = hm.phone) as last_active
      from public.hometeam_members hm
      union all
      select
        nc.phone as phone,
        'A neighbor' as display_name,
        'neighbor' as kind,
        true as active,
        true as opted_in,
        nc.consents_to_after_hours as consents_to_after_hours,
        to_char(nc.consented_at, 'YYYY-MM-DD"T"HH24:MI:SSOF') as opted_in_at,
        (select to_char(max(pt.updated_at), 'YYYY-MM-DD"T"HH24:MI:SSOF')
         from public.push_tokens pt where pt.phone = nc.phone) as last_active
      from public.notice_consents nc
      where not exists (
        select 1 from public.hometeam_members hm where hm.phone = nc.phone
      )
      union all
      select
        r.phone as phone,
        r.display_name as display_name,
        'staff' as kind,
        r.active as active,
        true as opted_in,
        true as consents_to_after_hours,
        null as opted_in_at,
        (select to_char(max(pt.updated_at), 'YYYY-MM-DD"T"HH24:MI:SSOF')
         from public.push_tokens pt where pt.phone = r.phone) as last_active
      from public.outreach_roster r
    ) t;
    return jsonb_build_object('ok', true, 'role', 'admin', 'members', v_full);
  end if;
  -- staff_limited: redacted — names + kind + active/paused. Nothing else.
  select coalesce(jsonb_agg(row_to_json(t) order by t.display_name), '[]'::jsonb)
  into v_redacted
  from (
    select
      hm.display_name as display_name,
      'hometeam' as kind,
      hm.status = 'active' as active
    from public.hometeam_members hm
    union all
    select
      'A neighbor' as display_name,
      'neighbor' as kind,
      true as active
    from public.notice_consents nc
    where not exists (
      select 1 from public.hometeam_members hm where hm.phone = nc.phone
    )
    union all
    select
      r.display_name as display_name,
      'staff' as kind,
      r.active as active
    from public.outreach_roster r
  ) t;
  return jsonb_build_object('ok', true, 'role', 'staff_limited', 'members', v_redacted);
end;
$sg$;
-- ---------------------------------------------------------------------------
-- sg_notice_consents_upsert(p_phone, p_after_hours, p_source): self-service
-- opt-in. Anyone with their own phone number may set their own consent
-- (the consent API route checks the phone belongs to the caller device via
-- the x-sg-phone parity pattern). Idempotent — refreshes timestamps.
-- ---------------------------------------------------------------------------
create or replace function public.sg_notice_consents_upsert(
  p_phone text, p_after_hours boolean, p_source text, p_sms boolean default null
)
returns boolean
language plpgsql security definer set search_path = public
as $sg$
declare
  v_phone text := public.sg_norm_phone(p_phone);
  v_source text := btrim(coalesce(p_source, '')) ;
begin
  if char_length(v_phone) < 7 or char_length(v_phone) > 15 then
    raise exception 'That phone number looks incomplete — please check it and try again, no rush.';
  end if;
  -- SMS consent (owner-approved 2026-09-08): set ONLY on explicit opt-in
  -- (p_sms true); later saves never clear an existing opt-in or opt-out.
  if public.sg_column_exists('notice_consents', 'sms_consent') then
    execute format('insert into public.notice_consents (phone, consented_at, consents_to_after_hours, source, sms_consent)'
                   ' values (%L, now(), %s, %L, %s)'
                   ' on conflict (phone) do update'
                   ' set consented_at = now(),'
                   ' consents_to_after_hours = %s,'
                   ' source = %L,'
                   ' sms_consent = case when %s then true else public.notice_consents.sms_consent end',
                   v_phone,
                   case when coalesce(p_after_hours, false) then 'true' else 'false' end,
                   nullif(v_source, ''), case when coalesce(p_sms, false) then 'true' else 'false' end,
                   case when coalesce(p_after_hours, false) then 'true' else 'false' end,
                   nullif(v_source, ''),
                   case when coalesce(p_sms, false) then 'true' else 'false' end);
  else
    insert into public.notice_consents (phone, consented_at, consents_to_after_hours, source)
    values (v_phone, now(), coalesce(p_after_hours, false),
            nullif(v_source, ''))
    on conflict (phone) do update
      set consented_at = now(),
          consents_to_after_hours = coalesce(p_after_hours, false),
          source = nullif(v_source, '');
  end if;
  return true;
end;
$sg$;
-- ---------------------------------------------------------------------------
-- sg_notice_eligible(p_caller_phone, p_audience): pre-send eligibility for
-- the confirm screen. Roster-only (any active role — counts are not
-- sensitive). Returns {eligible, skipped_after_hours}. Client labels these
-- "~N" estimates; the SEND set is recomputed at send time in M4.
-- ---------------------------------------------------------------------------
create or replace function public.sg_notice_eligible(p_caller_phone text, p_audience text)
returns jsonb
language plpgsql stable security definer set search_path = public
as $sg$
declare
  v_caller text := public.sg_norm_phone(p_caller_phone);
  v_elig int := 0;
  v_skip int := 0;
begin
  if not public.is_roster_staff(v_caller) then
    raise exception 'This space is for the outreach team.';
  end if;
  select
    count(*) filter (where not r.skipped_after_hours),
    count(*) filter (where r.skipped_after_hours)
  into v_elig, v_skip
  from public.sg_notice_recipients(p_audience) r;
  return jsonb_build_object(
    'ok', true,
    'eligible', coalesce(v_elig, 0),
    'skipped_after_hours', coalesce(v_skip, 0)
  );
end;
$sg$;
-- ---------------------------------------------------------------------------
-- sg_send_group_notice(p_caller_phone, p_title, p_body, p_audience):
-- admin-only send intent. Validates, computes the eligible set at Marin-local
-- send time, RAISES on an empty set (calm reason — nothing sent, nothing
-- logged), writes the group_notices log row with counts, and returns
-- {notice_id, phones, sent_count, skipped_after_hours} so the API route can
-- fan out via sendFcmMessage per registered token (separate path from the
-- emergency-alert audience path — separate RPC, separate log).
-- No-token recipients are counted as skipped_no_token (not failed).
-- ---------------------------------------------------------------------------
create or replace function public.sg_send_group_notice(
  p_caller_phone text, p_title text, p_body text, p_audience text
)
returns jsonb
language plpgsql security definer set search_path = public
as $sg$
declare
  v_caller text := public.sg_norm_phone(p_caller_phone);
  v_title text := btrim(coalesce(p_title, ''));
  v_body text := btrim(coalesce(p_body, ''));
  v_aud text := btrim(coalesce(p_audience, ''));
  v_elig int := 0;
  v_skip int := 0;
  v_id uuid;
  v_phones text[];
begin
  if not public.is_roster_admin(v_caller) then
    raise exception 'Only an outreach admin can send group notices.';
  end if;
  if char_length(v_title) < 1 then
    raise exception 'Give the notice a short headline first.';
  end if;
  if char_length(v_title) > 80 then
    raise exception 'Please keep the headline to 80 characters so it fits a notification.';
  end if;
  if char_length(v_body) < 1 then
    raise exception 'Write a line or two for the notice body first.';
  end if;
  if char_length(v_body) > 500 then
    raise exception 'Please keep the notice body to 500 characters so it stays quick to read.';
  end if;
  if v_aud not in ('hometeam', 'neighbors', 'both') then
    raise exception 'Please choose who this notice is for — HomeTeam, neighbors, or both.';
  end if;
  select
    count(*) filter (where not r.skipped_after_hours),
    count(*) filter (where r.skipped_after_hours),
    coalesce(array_agg(r.phone) filter (where not r.skipped_after_hours), '{}')
  into v_elig, v_skip, v_phones
  from public.sg_notice_recipients(v_aud) r;
  v_elig := coalesce(v_elig, 0);
  v_skip := coalesce(v_skip, 0);
  if v_elig = 0 then
    raise exception 'Right now that choice would reach no one — try during business hours (8am–6pm weekdays), or check who is opted in.';
  end if;
  insert into public.group_notices
    (sent_by_phone, title, body, audience, eligible_count, skipped_after_hours)
  values (v_caller, v_title, v_body, v_aud, v_elig, v_skip)
  returning id into v_id;
  return jsonb_build_object(
    'ok', true,
    'notice_id', v_id,
    'phones', coalesce(to_jsonb(v_phones), '[]'::jsonb),
    'eligible', v_elig,
    'skipped_after_hours', v_skip
  );
end;
$sg$;
-- ---------------------------------------------------------------------------
-- sg_notice_history(p_caller_phone): admin-only log, newest-first.
-- staff_limited raises (no history access; analytics stay admin-only).
-- ---------------------------------------------------------------------------
create or replace function public.sg_notice_history(p_caller_phone text)
returns jsonb
language plpgsql stable security definer set search_path = public
as $sg$
declare
  v_caller text := public.sg_norm_phone(p_caller_phone);
  v_rows jsonb;
begin
  if not public.is_roster_admin(v_caller) then
    raise exception 'This space is for the outreach team.';
  end if;
  select coalesce(jsonb_agg(row_to_json(t) order by t.created_at desc), '[]'::jsonb)
  into v_rows
  from (
    select
      gn.id,
      gn.title,
      gn.body,
      gn.audience,
      gn.eligible_count as eligible,
      gn.sent_count as sent,
      gn.skipped_after_hours,
      gn.skipped_no_token,
      coalesce(r.display_name, 'Outreach') as sent_by_name,
      to_char(gn.created_at, 'YYYY-MM-DD"T"HH24:MI:SSOF') as created_at
    from public.group_notices gn
    left join public.outreach_roster r on r.phone = gn.sent_by_phone
    order by gn.created_at desc
    limit 50
  ) t;
  return jsonb_build_object('ok', true, 'notices', v_rows);
end;
$sg$;
-- ---------------------------------------------------------------------------
-- Pause/resume stay admin-only for roster/consent state: wrap the existing
-- HomeTeam pause/resume so staff_limited callers are rejected server-side
-- (staff_limited may claim/deliver supplies but never changes roster/consent
-- state). Admin callers delegate to the existing hometeam_* semantics.
-- ---------------------------------------------------------------------------
create or replace function public.sg_hometeam_pause(p_caller_phone text, p_phone text)
returns boolean
language plpgsql security definer set search_path = public
as $sg$
declare
  v_caller text := public.sg_norm_phone(p_caller_phone);
begin
  if not public.is_roster_admin(v_caller) then
    raise exception 'Only an outreach admin can pause a HomeTeam member.';
  end if;
  perform public.hometeam_pause(p_phone);
  return true;
end;
$sg$;
create or replace function public.sg_hometeam_resume(p_caller_phone text, p_phone text)
returns boolean
language plpgsql security definer set search_path = public
as $sg$
declare
  v_caller text := public.sg_norm_phone(p_caller_phone);
begin
  if not public.is_roster_admin(v_caller) then
    raise exception 'Only an outreach admin can resume a HomeTeam member.';
  end if;
  perform public.hometeam_resume(p_phone);
  return true;
end;
$sg$;
create index if not exists idx_group_notices_created on public.group_notices (created_at desc);
-- ---------------------------------------------------------------------------
-- Trusted-peer phone connections (spec §1, 2026-09-07)
--
-- Phone-invite layer over the existing uuid-based trusted_peers pairing table:
--   * M1 users.phone (nullable, unique, digits-only) — bound at sign-in /
--     invite-accept from the caller-supplied phone after sg_norm_phone.
--     RLS stays own-row-only; reads go through the RPCs below.
--   * M2 sg_peer_lookup — single-number exact match, {exists, display_name}
--     only (first name), rate-limited ≤10/day per caller, never lists.
--   * M3 sg_peer_invite — resolves by phone, idempotent pending row, calm
--     raise when the number has no account (→ share-a-code path).
--   * M4 sg_peer_accept / sg_peer_decline — accept flips pending + writes
--     the reciprocal accepted row (mutual-accept RLS); decline deletes
--     silently (inviter sees "no longer pending", never a name).
--   * M5 sg_peer_remove — deletes both directional rows instantly (also the
--     cancel path for an outgoing pending invite).
--   * M6 peer_notes — deferred-delivery outbox (delivered_at stays NULL
--     until the messaging wave; the UI reads it as "saved, not delivered").
--   * peer_invite_codes — PEER-3 fallback: 6-char codes, 48h expiry, redeem
--     INTO a pending invite (mutual consent preserved).
-- All RPCs are SECURITY DEFINER, calm-error, phone-normalized. No contact
-- import, no enumeration, no background anything — one typed number only.
-- ---------------------------------------------------------------------------
alter table public.users add column if not exists phone text;
create unique index if not exists users_phone_unique on public.users (phone);

create table if not exists public.peer_lookup_log (
  id           uuid primary key default gen_random_uuid(),
  caller_phone text not null check (char_length(caller_phone) between 7 and 20),
  target_phone text not null check (char_length(target_phone) between 7 and 20),
  created_at   timestamptz not null default now()
);
alter table public.peer_lookup_log enable row level security;
-- RPC-only: no direct client policies (same pattern as group_notices).
create index if not exists idx_peer_lookup_log_caller on public.peer_lookup_log (caller_phone, created_at desc);

create table if not exists public.peer_invite_codes (
  code            text primary key check (code ~ '^[A-Z2-9]{6}$'),
  inviter_user_id uuid not null references public.users (id) on delete cascade,
  created_at      timestamptz not null default now(),
  expires_at      timestamptz not null default (now() + interval '48 hours'),
  redeemed_by     uuid references public.users (id) on delete set null,
  redeemed_at     timestamptz
);
alter table public.peer_invite_codes enable row level security;
-- RPC-only: no direct client policies.
create index if not exists idx_peer_invite_codes_inviter on public.peer_invite_codes (inviter_user_id, created_at desc);

create table if not exists public.peer_notes (
  id                uuid primary key default gen_random_uuid(),
  sender_user_id    uuid not null references public.users (id) on delete cascade,
  recipient_user_id uuid not null references public.users (id) on delete cascade,
  note              text not null check (char_length(note) between 1 and 140),
  created_at        timestamptz not null default now(),
  delivered_at      timestamptz,
  read_at           timestamptz,
  check (sender_user_id <> recipient_user_id)
);
alter table public.peer_notes enable row level security;
drop policy if exists "peer notes sender insert" on public.peer_notes;
create policy "peer notes sender insert" on public.peer_notes for insert
  with check (sender_user_id in (
    select u.id from public.users u
    where u.phone = current_setting('request.headers', true)::json ->> 'x-sg-phone'));
drop policy if exists "peer notes party read" on public.peer_notes;
create policy "peer notes party read" on public.peer_notes for select
  using (sender_user_id in (
    select u.id from public.users u
    where u.phone = current_setting('request.headers', true)::json ->> 'x-sg-phone')
  or recipient_user_id in (
    select u.id from public.users u
    where u.phone = current_setting('request.headers', true)::json ->> 'x-sg-phone'));
drop policy if exists "peer notes recipient receipt" on public.peer_notes;
create policy "peer notes recipient receipt" on public.peer_notes for update
  using (recipient_user_id in (
    select u.id from public.users u
    where u.phone = current_setting('request.headers', true)::json ->> 'x-sg-phone'))
  with check (recipient_user_id in (
    select u.id from public.users u
    where u.phone = current_setting('request.headers', true)::json ->> 'x-sg-phone'));
create index if not exists idx_peer_notes_sender on public.peer_notes (sender_user_id, created_at desc);
create index if not exists idx_peer_notes_recipient on public.peer_notes (recipient_user_id, created_at desc);

-- Bind (or verify) the caller's phone to their user row: the M1 "set at
-- sign-in / invite-accept" step. Shared by every phone-aware peer RPC.
create or replace function public.sg_peer_self(p_user_id uuid, p_phone text)
returns uuid language plpgsql security definer set search_path = public
as $sg$
declare
  v_phone text := public.sg_norm_phone(p_phone);
  v_found boolean;
begin
  select true into v_found from public.users where id = p_user_id;
  if not coalesce(v_found, false) then
    raise exception 'We could not find your sign-in — try signing in again, no rush.';
  end if;
  if v_phone <> '' then
    if char_length(v_phone) < 7 or char_length(v_phone) > 15 then
      raise exception 'That phone number looks incomplete — please check it and try again, no rush.';
    end if;
    if exists (select 1 from public.users where phone = v_phone and id <> p_user_id) then
      raise exception 'That number is already in use on another sign-in — nothing was changed.';
    end if;
    update public.users set phone = v_phone, updated_at = now() where id = p_user_id;
  end if;
  return p_user_id;
end;
$sg$;

-- M2: single-number lookup. Returns ONLY {exists, display_name} (first name)
-- for that one number. Rate-limited: ≤10/day per caller, gentle block after.
create or replace function public.sg_peer_lookup(p_caller_phone text, p_target_phone text)
returns jsonb language plpgsql security definer set search_path = public
as $sg$
declare
  v_caller text := public.sg_norm_phone(p_caller_phone);
  v_target text := public.sg_norm_phone(p_target_phone);
  v_count int;
  v_name text;
begin
  if char_length(v_caller) < 7 or char_length(v_caller) > 15 then
    raise exception 'Add your own number first — then you can look up one number at a time.';
  end if;
  if char_length(v_target) < 7 or char_length(v_target) > 15 then
    raise exception 'That number looks incomplete — check it and try again, no rush.';
  end if;
  select count(*) into v_count from public.peer_lookup_log
  where caller_phone = v_caller and created_at > now() - interval '1 day';
  if v_count >= 10 then
    raise exception 'You have looked up several numbers today — take a rest and try again tomorrow.';
  end if;
  insert into public.peer_lookup_log (caller_phone, target_phone) values (v_caller, v_target);
  select split_part(u.display_name, ' ', 1) into v_name
  from public.users u where u.phone = v_target;
  if v_name is null then
    return jsonb_build_object('ok', true, 'exists', false, 'display_name', null);
  end if;
  return jsonb_build_object('ok', true, 'exists', true, 'display_name', v_name);
end;
$sg$;

-- M3: invite by phone. Resolves the target by phone, inserts an idempotent
-- pending row, raises calmly when the number has no account (→ code path).
create or replace function public.sg_peer_invite(p_caller_user_id uuid, p_target_phone text)
returns jsonb language plpgsql security definer set search_path = public
as $sg$
declare
  v_target text := public.sg_norm_phone(p_target_phone);
  v_caller_phone text;
  v_target_id uuid;
  v_target_name text;
  v_status text;
begin
  select phone into v_caller_phone from public.users where id = p_caller_user_id;
  if v_caller_phone is null then
    raise exception 'Add your number first — then you can invite someone you trust.';
  end if;
  if char_length(v_target) < 7 or char_length(v_target) > 15 then
    raise exception 'That number looks incomplete — check it and try again, no rush.';
  end if;
  if v_target = v_caller_phone then
    raise exception 'That is your own number — invite someone you trust instead.';
  end if;
  select u.id, split_part(u.display_name, ' ', 1) into v_target_id, v_target_name
  from public.users u where u.phone = v_target;
  if v_target_id is null then
    raise exception 'No neighbor on that number yet — you can share an invite code instead.';
  end if;
  -- They already invited me and I invite back: that IS mutual consent.
  select status into v_status from public.trusted_peers
  where requester_id = v_target_id and peer_id = p_caller_user_id;
  if v_status = 'pending' then
    update public.trusted_peers set status = 'accepted', updated_at = now()
    where requester_id = v_target_id and peer_id = p_caller_user_id;
    insert into public.trusted_peers (requester_id, peer_id, status)
    values (p_caller_user_id, v_target_id, 'accepted')
    on conflict (requester_id, peer_id) do update set status = 'accepted', updated_at = now();
    return jsonb_build_object('ok', true, 'status', 'accepted', 'display_name', v_target_name);
  end if;
  select status into v_status from public.trusted_peers
  where requester_id = p_caller_user_id and peer_id = v_target_id;
  if v_status is not null then
    return jsonb_build_object('ok', true, 'status', v_status, 'display_name', v_target_name);
  end if;
  insert into public.trusted_peers (requester_id, peer_id, status)
  values (p_caller_user_id, v_target_id, 'pending');
  return jsonb_build_object('ok', true, 'status', 'pending', 'display_name', v_target_name);
end;
$sg$;

-- M4: invitee accepts (binds their phone per M1) — flips pending + writes the
-- reciprocal accepted row that satisfies the mutual-accept RLS.
create or replace function public.sg_peer_accept(p_caller_user_id uuid, p_caller_phone text, p_other_user_id uuid)
returns jsonb language plpgsql security definer set search_path = public
as $sg$
declare
  v_name text;
  v_already boolean;
begin
  perform public.sg_peer_self(p_caller_user_id, p_caller_phone);
  select split_part(u.display_name, ' ', 1) into v_name
  from public.users u where u.id = p_other_user_id;
  if v_name is null then
    raise exception 'That invite is not waiting anymore — nothing changed.';
  end if;
  update public.trusted_peers set status = 'accepted', updated_at = now()
  where requester_id = p_other_user_id and peer_id = p_caller_user_id and status = 'pending';
  if not found then
    select true into v_already from public.trusted_peers
    where requester_id = p_other_user_id and peer_id = p_caller_user_id and status = 'accepted';
    if coalesce(v_already, false) then
      return jsonb_build_object('ok', true, 'status', 'accepted', 'display_name', v_name);
    end if;
    raise exception 'That invite is not waiting anymore — nothing changed.';
  end if;
  insert into public.trusted_peers (requester_id, peer_id, status)
  values (p_caller_user_id, p_other_user_id, 'accepted')
  on conflict (requester_id, peer_id) do update set status = 'accepted', updated_at = now();
  return jsonb_build_object('ok', true, 'status', 'accepted', 'display_name', v_name);
end;
$sg$;

-- M4: invitee declines — deletes the pending row silently (no blame; the
-- inviter simply sees "no longer pending").
create or replace function public.sg_peer_decline(p_caller_user_id uuid, p_other_user_id uuid)
returns jsonb language plpgsql security definer set search_path = public
as $sg$
begin
  perform public.sg_peer_self(p_caller_user_id, '');
  delete from public.trusted_peers
  where requester_id = p_other_user_id and peer_id = p_caller_user_id and status = 'pending';
  return jsonb_build_object('ok', true);
end;
$sg$;

-- M5: remove (or cancel an outgoing pending invite) — deletes BOTH
-- directional rows instantly, whatever their status.
create or replace function public.sg_peer_remove(p_caller_user_id uuid, p_other_user_id uuid)
returns jsonb language plpgsql security definer set search_path = public
as $sg$
begin
  perform public.sg_peer_self(p_caller_user_id, '');
  delete from public.trusted_peers
  where (requester_id = p_caller_user_id and peer_id = p_other_user_id)
     or (requester_id = p_other_user_id and peer_id = p_caller_user_id);
  return jsonb_build_object('ok', true);
end;
$sg$;

-- PEER-3: mint (or reuse) my 6-char invite code, 48h expiry.
create or replace function public.sg_peer_code_create(p_caller_user_id uuid)
returns jsonb language plpgsql security definer set search_path = public
as $sg$
declare
  v_found boolean;
  v_code text;
  v_expires timestamptz;
  v_alphabet text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  v_tries int := 0;
begin
  perform public.sg_peer_self(p_caller_user_id, '');
  select true into v_found
  from public.peer_invite_codes c
  where c.inviter_user_id = p_caller_user_id
    and c.redeemed_by is null and c.expires_at > now()
  order by c.created_at desc limit 1;
  if coalesce(v_found, false) then
    select c.code, c.expires_at into v_code, v_expires
    from public.peer_invite_codes c
    where c.inviter_user_id = p_caller_user_id
      and c.redeemed_by is null and c.expires_at > now()
    order by c.created_at desc limit 1;
    return jsonb_build_object('ok', true, 'code', v_code, 'expires_at', v_expires);
  end if;
  loop
    v_tries := v_tries + 1;
    select string_agg(substr(v_alphabet, (random() * 31)::int + 1, 1), '')
    into v_code from generate_series(1, 6);
    begin
      insert into public.peer_invite_codes (code, inviter_user_id)
      values (v_code, p_caller_user_id)
      returning expires_at into v_expires;
      return jsonb_build_object('ok', true, 'code', v_code, 'expires_at', v_expires);
    exception when unique_violation then
      if v_tries >= 5 then
        raise exception 'That did not go through — try again in a moment.';
      end if;
    end;
  end loop;
end;
$sg$;

-- PEER-3: redeem a code INTO a pending invite (inviter → me). The redeemer
-- still accepts on PEER-1 — mutual consent is preserved.
create or replace function public.sg_peer_code_redeem(p_caller_user_id uuid, p_code text)
returns jsonb language plpgsql security definer set search_path = public
as $sg$
declare
  v_code text := upper(regexp_replace(coalesce(p_code, ''), '[^a-zA-Z0-9]', '', 'g'));
  v_inviter uuid;
  v_expires timestamptz;
  v_redeemed uuid;
  v_name text;
begin
  perform public.sg_peer_self(p_caller_user_id, '');
  select c.inviter_user_id, c.expires_at, c.redeemed_by
  into v_inviter, v_expires, v_redeemed
  from public.peer_invite_codes c where c.code = v_code;
  if v_inviter is null then
    raise exception 'That code did not work — check it or ask for a new one.';
  end if;
  if v_expires <= now() then
    raise exception 'Codes last 48h — ask them to make a new one.';
  end if;
  if v_inviter = p_caller_user_id then
    raise exception 'That is your own code — share it with someone you trust instead.';
  end if;
  select split_part(u.display_name, ' ', 1) into v_name
  from public.users u where u.id = v_inviter;
  if v_redeemed is not null and v_redeemed <> p_caller_user_id then
    raise exception 'That code was already used — ask them to make a new one.';
  end if;
  if v_redeemed = p_caller_user_id then
    return jsonb_build_object('ok', true, 'inviter_name', v_name);
  end if;
  update public.peer_invite_codes
  set redeemed_by = p_caller_user_id, redeemed_at = now()
  where code = v_code;
  insert into public.trusted_peers (requester_id, peer_id, status)
  values (v_inviter, p_caller_user_id, 'pending')
  on conflict (requester_id, peer_id) do nothing;
  return jsonb_build_object('ok', true, 'inviter_name', v_name);
end;
$sg$;

-- NOTE-1: save a kind note (deferred delivery — delivered_at stays NULL
-- until the messaging wave; <=20/day per sender; mutual peers only).
create or replace function public.sg_note_save(p_sender_user_id uuid, p_recipient_user_id uuid, p_note text)
returns jsonb language plpgsql security definer set search_path = public
as $sg$
declare
  v_note text := btrim(coalesce(p_note, ''));
  v_today int;
  v_id uuid;
  v_at timestamptz;
begin
  perform public.sg_peer_self(p_sender_user_id, '');
  if char_length(v_note) = 0 then
    raise exception 'Write a line or two first — even a few kind words matter.';
  end if;
  if char_length(v_note) > 140 then
    raise exception 'Please keep the note to 140 characters so it stays quick to read.';
  end if;
  if not exists (select 1 from public.users where id = p_recipient_user_id) then
    raise exception 'We could not find that peer — nothing was saved.';
  end if;
  if not exists (
    select 1 from public.trusted_peers a
    join public.trusted_peers b
      on b.requester_id = a.peer_id and b.peer_id = a.requester_id
    where a.requester_id = p_sender_user_id and a.peer_id = p_recipient_user_id
      and a.status = 'accepted' and b.status = 'accepted'
  ) then
    raise exception 'You can only save notes for a trusted peer you both chose — nothing was saved.';
  end if;
  select count(*) into v_today from public.peer_notes
  where sender_user_id = p_sender_user_id and created_at > now() - interval '1 day';
  if v_today >= 20 then
    raise exception 'You have saved plenty of notes today — take a rest and try again tomorrow.';
  end if;
  insert into public.peer_notes (sender_user_id, recipient_user_id, note)
  values (p_sender_user_id, p_recipient_user_id, v_note)
  returning id, created_at into v_id, v_at;
  return jsonb_build_object('ok', true, 'id', v_id, 'created_at', v_at);
end;
$sg$;

-- NOTE-1: my sent notes, newest first (the "Saved notes" sender view).
create or replace function public.sg_notes_mine(p_caller_user_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public
as $sg$
declare
  v_rows jsonb;
begin
  perform public.sg_peer_self(p_caller_user_id, '');
  select coalesce(jsonb_agg(row_to_json(t) order by t.created_at desc), '[]'::jsonb)
  into v_rows
  from (
    select
      n.id,
      n.note,
      split_part(u.display_name, ' ', 1) as recipient_name,
      to_char(n.created_at, 'YYYY-MM-DD"T"HH24:MI:SSOF') as created_at,
      case when n.delivered_at is null then 'saved' else 'delivered' end as status
    from public.peer_notes n
    join public.users u on u.id = n.recipient_user_id
    where n.sender_user_id = p_caller_user_id
    order by n.created_at desc
    limit 50
  ) t;
  return jsonb_build_object('ok', true, 'notes', v_rows);
end;
$sg$;
comment on table public.peer_notes is
  'Deferred-delivery kind notes between mutual trusted peers (1:1 only — '
  'never staff, never public). delivered_at stays NULL until the messaging '
  'wave ships; the UI reads it as "saved, not yet delivered". Plain text; '
  '<=20/day per sender; <=140 chars.';
comment on table public.peer_invite_codes is
  'PEER-3 fallback invite codes: 6 chars, 48h expiry. Redeeming creates a '
  'pending trusted_peers invite the redeemer still accepts — mutual consent '
  'preserved. The app never sends SMS; the inviter shares the code themself.';
comment on column public.users.phone is
  'Digits-only phone (nullable, unique) — bound at sign-in / invite-accept '
  'after sg_norm_phone. Powers phone invites + lookups via RPC only; RLS '
  'stays own-row-only.';
-- ---------------------------------------------------------------------------
-- Anonymous analytics events (owner-directed 2026-09-07)
--
-- Aggregate counters ONLY for the /admin/analytics dashboard + the monthly
-- grant impact CSV. ZERO PII by construction: the table has EXACTLY six
-- columns — no user_id, no phone, no IP, no lat/lng, no free text, no
-- headers, no user-agent. Queries read counts/category/status/install-counts
-- only; NOTHING here can identify a person. Do NOT add PII columns to this
-- table, ever.
-- ---------------------------------------------------------------------------
create table if not exists public.analytics_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null check (event_type in ('resource_search','peer_support_request','sweep_alert_view','check_in')),
  category text null,
  status text null,
  install_id uuid null,
  created_at timestamptz not null default now()
);
comment on column public.analytics_events.install_id is
  'ANALYTICS: no PII — never join to users/check_ins/push_tokens/outreach_roster';
create index if not exists idx_analytics_events_month on public.analytics_events (created_at, event_type);
-- ---------------------------------------------------------------------------
-- SMS opt-in layer (owner-approved 2026-09-08) — consent-first outbound
-- texting as a reliability layer over push.
--
-- Floor (enforced in src/lib/smsServer.ts + the send routes, never client):
--  - sms_consent (default false) beside consents_to_after_hours on BOTH
--    consent stores (hometeam_members + notice_consents). No consent = no SMS.
--  - sms_unsubscribed (default false): Reply-STOP sets it; send skips it.
--  - Business hours (Mon–Fri 8am–6pm America/Los_Angeles) unless
--    consents_to_after_hours — EXCEPT true emergency dispatch, which sends
--    regardless. Analytics: aggregate counters only, zero PII — never log
--    phone numbers. Twilio creds live in env (TWILIO_ACCOUNT_SID /
--    TWILIO_AUTH_TOKEN / TWILIO_FROM_NUMBER), referenced server-side only.
--  - Twilio inbound webhook: POST <live-base>/api/sms/inbound (set in the
--    Twilio console). Always 2xx, empty TwiML.
-- ---------------------------------------------------------------------------
alter table public.hometeam_members
  add column if not exists sms_consent boolean not null default false;
alter table public.hometeam_members
  add column if not exists sms_unsubscribed boolean not null default false;
alter table public.notice_consents
  add column if not exists sms_consent boolean not null default false;
alter table public.notice_consents
  add column if not exists sms_unsubscribed boolean not null default false;
-- Group-notice SMS fan-out counters (aggregate only — no per-phone rows).
alter table public.group_notices
  add column if not exists sms_sent int not null default 0 check (sms_sent >= 0);
alter table public.group_notices
  add column if not exists sms_skipped int not null default 0 check (sms_skipped >= 0);
-- sg_sms_unsubscribe(p_phone): Reply-STOP handler — idempotent, never raises
-- for unknown numbers (STOP must never 500). Callable by the inbound webhook.
create or replace function public.sg_sms_unsubscribe(p_phone text)
returns boolean
language plpgsql security definer set search_path = public
as $sg$
declare
  v_phone text := public.sg_norm_phone(p_phone);
begin
  update public.hometeam_members set sms_unsubscribed = true
  where substring(phone from length(phone) - 9) = substring(v_phone from length(v_phone) - 9);
  update public.notice_consents set sms_unsubscribed = true
  where substring(phone from length(phone) - 9) = substring(v_phone from length(v_phone) - 9);
  return true;
end;
$sg$;

-- ---------------------------------------------------------------------------
-- staff_sms_recipients — SMS dispatch recipients for peer-support + urgent
-- needs (owner-directed 2026-09-10).
--
-- WHO: MPRCC peer workers who should RECEIVE dispatch texts when a neighbor
-- taps "Request peer support" or sends an urgent need. Today that is Jenn +
-- Bambi (seeded below); admins can add more peer supporters in-app.
--
-- WHY NOT JUST outreach_roster: roster members may legitimately not want SMS on
-- their personal line (push is the primary channel); this table is the explicit
-- opt-in list for texts, with its own consent flags so the SMS floor rules
-- (opt-in only, Reply-STOP always wins, hours rule) apply to staff dispatch
-- exactly as they do to HomeTeam/neighbor sends.
--
-- Consent model (non-negotiable SMS floor):
--   * sms_consent defaults TRUE — staff are on call (owner intent: they always
--     get dispatch texts), matching the plan's "true emergency dispatch to
--     staff" rule. An admin adding a recipient is the consent action.
--   * consents_to_after_hours defaults TRUE — dispatch texts are emergency
--     dispatch to staff, so business-hours never blocks them; the column stays
--     for future non-emergency staff sends and for admins to see/adjust.
--   * sms_unsubscribed (Reply-STOP) ALWAYS wins — set by the inbound webhook
--     (markSmsUnsubscribed + sg_sms_unsubscribe) and NEVER cleared by the
--     admin add/upsert path.
--   * active=false is a soft remove (admin UI); the row stays for STOP
--     integrity (the send fan-out only looks at active rows).
-- Phone is the identity, stored 11-digit with country code like outreach_roster
-- (14158797940); matching uses the last-10-digits convention everywhere
-- (substring(phone from length(phone) - 9), phoneKey in src/lib/pushServer.ts).
-- ---------------------------------------------------------------------------
create table if not exists public.staff_sms_recipients (
  id                      uuid primary key default gen_random_uuid(),
  phone                   text not null check (char_length(phone) between 7 and 20),
  name                    text not null check (char_length(name) between 1 and 40),
  sms_consent             boolean not null default true,
  consents_to_after_hours boolean not null default true,
  sms_unsubscribed        boolean not null default false,
  active                  boolean not null default true,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);
alter table public.staff_sms_recipients enable row level security;
-- RPC/server-only (same pattern as group_notices): the app's server role reads/
-- writes this table through src/routes/api/staff-sms + src/lib/smsServer.ts;
-- no direct client policies exist. Never output a full phone to any client —
-- the list API masks to the last 4 digits.

-- Idempotent seed (owner-directed 2026-09-10): exactly Jenn + Bambi on create.
-- Guarded per last-10 digits so re-runs (and re-adds by admins) never duplicate.
insert into public.staff_sms_recipients (phone, name, sms_consent, consents_to_after_hours, active)
select v.phone, v.name, true, true, true
from (values
  ('14158797940', 'Jenn Mallow'),
  ('14155249090', 'Carrie Bambi Klyse')
) as v(phone, name)
where not exists (
  select 1 from public.staff_sms_recipients s
  where substring(s.phone from length(s.phone) - 9) = substring(v.phone from length(v.phone) - 9)
);

-- Unique per last-10 digits: the admin upsert matches on this key, so a
-- 10-digit vs 11-digit form of the same number can never create two rows.
create unique index if not exists idx_staff_sms_recipients_phone10
  on public.staff_sms_recipients (substring(phone from length(phone) - 9));
create index if not exists idx_staff_sms_recipients_active
  on public.staff_sms_recipients (active);

-- Reply-STOP extends to staff dispatch recipients too: a real STOP from a peer
-- supporter marks their staff_sms_recipients row unsubscribed (STOP always wins
-- everywhere). `create or replace` redefines the earlier function.
create or replace function public.sg_sms_unsubscribe(p_phone text)
returns boolean
language plpgsql security definer set search_path = public
as $sg$
declare
  v_phone text := public.sg_norm_phone(p_phone);
begin
  update public.hometeam_members set sms_unsubscribed = true
  where substring(phone from length(phone) - 9) = substring(v_phone from length(v_phone) - 9);
  update public.notice_consents set sms_unsubscribed = true
  where substring(phone from length(phone) - 9) = substring(v_phone from length(v_phone) - 9);
  update public.staff_sms_recipients set sms_unsubscribed = true
  where substring(phone from length(phone) - 9) = substring(v_phone from length(v_phone) - 9);
  return true;
end;
$sg$;

comment on table public.staff_sms_recipients is
  'MPRCC SMS dispatch recipients (owner-directed 2026-09-10): peer workers who '
  'receive dispatch texts for peer-support requests + urgent needs. Seeded with '
  'Jenn Mallow + Carrie "Bambi" Klyse; admins add more in-app. sms_consent + '
  'consents_to_after_hours default TRUE (staff are on call — emergency dispatch '
  'to staff bypasses business hours, never consent/STOP); sms_unsubscribed '
  '(Reply STOP) always wins and is never cleared by the admin upsert; '
  'active=false soft-removes (row kept for STOP integrity). Phone matching is '
  'the last-10-digits convention used across the app.';

-- ---------------------------------------------------------------------------
-- resource_verifications — neighbor-reported listing changes (PR-C, owner-
-- directed 2026-09-11: "I NEED TO BE ABLE TO VERIFY RESOURCES").
--
-- A neighbor flags a listing (closed / info wrong / hours changed / other)
-- with a short note and an OPTIONAL phone (no account, no sign-in — R-P6/R-P7).
-- The row is the queue: outreach staff view pending rows (PIN-gated) and an
-- admin resolves the lifecycle:
--   * verified  — the listing is actually correct → resources.verified_at is
--                 stamped fresh (clean_slate: no users row exists for phone
--                 staff, so verified_by stays null — same convention as the
--                 sweep verify path) and the report resolves.
--   * resolved  — the report was handled (listing updated) but no freshness
--                 stamp is claimed.
--   * dismissed — not an issue.
-- resolved_by records the staff phone; resolved_note is the admin's record.
-- Access: RLS on, NO direct client policies (same pattern as group_notices /
-- peer_invite_codes) — every read/write flows through the server routes
-- (service role), which enforce the PIN gate. No phone is ever contactable
-- without the reporter choosing to share it; identical to every other table.
-- ---------------------------------------------------------------------------
create table if not exists public.resource_verifications (
  id            uuid primary key default gen_random_uuid(),
  resource_id   uuid not null references public.resources (id) on delete cascade,
  reported_by   text check (reported_by is null or char_length(reported_by) between 7 and 20),
  reason        text not null check (reason in ('closed', 'wrong_info', 'hours_changed', 'other')),
  note          text check (note is null or char_length(note) <= 500),
  status        text not null default 'pending'
                check (status in ('pending', 'resolved', 'dismissed')),
  created_at    timestamptz not null default now(),
  resolved_at   timestamptz,
  resolved_by   text check (resolved_by is null or char_length(resolved_by) between 7 and 20),
  resolved_note text check (resolved_note is null or char_length(resolved_note) <= 500)
);
alter table public.resource_verifications enable row level security;
-- Server-route access only (service role): no INSERT/SELECT/UPDATE policies,
-- so the anon key can never read or write another reporter's row.
create index if not exists idx_resource_verifications_status
  on public.resource_verifications (status, created_at desc);
create index if not exists idx_resource_verifications_resource
  on public.resource_verifications (resource_id, created_at desc);
comment on table public.resource_verifications is
  'Neighbor-reported listing changes (PR-C): pending rows are the outreach '
  'check-in queue. Anonymous report (optional phone) → staff view → admin '
  'resolves (verified stamps resources.verified_at; resolved = handled; '
  'dismissed = not an issue). RLS on, no client policies — server routes '
  'only, PIN-gated. Never auto-contacts anyone; the report itself is the only '
  'record.';
