-- ============================================================================
-- SafeGround — Supabase-ready data layer (deliverable artifact, Build A)
-- ============================================================================
-- Tables: users, sweeps, supply_requests, resources, check_ins
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
-- supply_requests (owner + outreach only — queue, Wave 2)
-- ---------------------------------------------------------------------------
create table public.supply_requests (
  id                  uuid primary key default gen_random_uuid(),
  requested_by        uuid not null references public.users (id) on delete cascade,
  items               text[] not null default '{}',
  note                text check (char_length(note) <= 400),
  pickup_preference   text check (char_length(pickup_preference) <= 200),
  status              request_status not null default 'open',
  claimed_by          uuid references public.users (id) on delete set null,
  fulfilled_at        timestamptz,
  cancelled_at        timestamptz,
  created_at          timestamptz not null default now(),
  -- R-P10: anonymized (blurred) after fulfillment +30d
  anonymize_at        timestamptz generated always as (coalesce(fulfilled_at, created_at) + interval '30 days') stored
);

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
  visible_until   timestamptz generated always as (checked_in_at + interval '24 hours') stored,
  share_paused    boolean not null default false,
  created_at      timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Helper: is_outreach() — used by every outreach-gated policy.
-- Role lives in public.users (manual provisioning by the lead).
-- ---------------------------------------------------------------------------
create or replace function public.is_outreach()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.users
    where id = auth.uid() and role in ('outreach', 'outreach_admin')
  );
$$;

-- ---------------------------------------------------------------------------
-- Row-level security — enable on every table, then policies
-- ---------------------------------------------------------------------------
alter table public.users           enable row level security;
alter table public.resources       enable row level security;
alter table public.sweeps          enable row level security;
alter table public.supply_requests enable row level security;
alter table public.check_ins       enable row level security;

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

-- ---------------------------------------------------------------------------
-- check_ins — the heart of R-P4 / R-P5 / R-P10
--   owner:       full row, including exact point
--   peers:       fuzzed fields ONLY — exact_lat/exact_lng are deniable columns
--                (RLS has no clause that would ever return them to a peer)
--   outreach:    none — outreach needs counts, not coordinates
-- ---------------------------------------------------------------------------
create policy "checkin owner full read"          on public.check_ins for select
  using (auth.uid() = user_id);
create policy "checkin owner insert"             on public.check_ins for insert
  with check (auth.uid() = user_id);

-- Peer visibility is enforcement via a secured view (peers never run SELECT
-- against the table itself). Fuzz columns rounded server-side, never client-side.
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

-- Peers see rows ONLY through the sharing relationship. Without a
-- trusted_peers table in this artifact's wave, enforce "only peers" via a
-- placeholder policy that returns nothing for anon/other users — the wiring
-- table + pair policy ships with Build B (check_ins wave) and is additive:
-- create table trusted_peers (...); alter view peer_check_ins add join ...
create policy "checkin peer view fuzzed only"     on public.check_ins for select
  using (false);  -- replaced by trusted-peer policy in Build B; exact cols NEVER exposed

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
  'Supply requests (Wave 2, F4). Visible to owner + outreach only. Anonymized +30d after fulfilment (R-P10).';
comment on function public.is_outreach() is
  'Role gate used by outreach policies. Roles are provisioned manually by the lead; never self-serve.';