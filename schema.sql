-- ============================================================================
-- SafeGround — Supabase-ready data layer (deliverable artifact, Build A)
-- ============================================================================
-- Tables: users, sweeps, supply_requests, resources, check_ins, trusted_peers,
--         hometeam_members, emergency_alerts, outreach_roster
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
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

alter table public.outreach_roster enable row level security;
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
  where phone = public.sg_norm_phone(p_phone) and active;
$sgfn$;

create or replace function public.is_roster_staff(p_phone text)
returns boolean language sql stable security definer set search_path = public
as $sgfn$
  select coalesce(bool_or(active), false)
  from public.outreach_roster
  where phone = public.sg_norm_phone(p_phone);
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
  select regexp_replace(coalesce(raw, ''), '[^0-9]', '', 'g')
$sgfn$;

-- "Join the HomeTeam": name + phone + explicit consent. Idempotent — joining
-- twice with the same phone reactivates + refreshes consent, never duplicates.
create or replace function public.hometeam_join(p_phone text, p_display_name text)
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
  insert into public.hometeam_members (phone, display_name, consented_to_contact_at, status)
  values (v_phone, v_name, now(), 'active')
  on conflict (phone) do update
    set display_name = excluded.display_name,
        consented_to_contact_at = now(),
        status = 'active'
  returning id into v_id;
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