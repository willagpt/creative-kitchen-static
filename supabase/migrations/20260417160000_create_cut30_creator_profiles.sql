-- Migration: create_cut30_creator_profiles
-- Creates the table that stores per-creator personalisation profiles for Cut30 lessons.
-- Each creator has a unique access_slug baked into their form URL so the public HTML
-- form can read/write their row without full auth, while preventing arbitrary creation.
--
-- Related: cut30_lessons, cut30_brand_applications.
-- The profile column is JSONB so the form schema can evolve without DDL changes.
-- RLS is permissive (matching the rest of this project's public tables). Write
-- access is gated at the edge function layer by access_slug match.

create table public.cut30_creator_profiles (
  id uuid primary key default gen_random_uuid(),
  creator_name text not null unique,
  brand_name text,
  access_slug text not null unique,
  profile jsonb not null default '{}'::jsonb,
  status text not null default 'draft' check (status in ('draft', 'complete')),
  completion_percent int not null default 0 check (completion_percent between 0 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_cut30_creator_profiles_slug on public.cut30_creator_profiles(access_slug);
create index idx_cut30_creator_profiles_status on public.cut30_creator_profiles(status);

-- Auto-update updated_at on every change.
create or replace function public._cut30_creator_profiles_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger cut30_creator_profiles_touch_updated_at
  before update on public.cut30_creator_profiles
  for each row execute function public._cut30_creator_profiles_touch_updated_at();

alter table public.cut30_creator_profiles enable row level security;

create policy "Anyone can select cut30_creator_profiles"
  on public.cut30_creator_profiles for select using (true);

create policy "Anyone can insert cut30_creator_profiles"
  on public.cut30_creator_profiles for insert with check (true);

create policy "Anyone can update cut30_creator_profiles"
  on public.cut30_creator_profiles for update using (true);

create policy "Anyone can delete cut30_creator_profiles"
  on public.cut30_creator_profiles for delete using (true);

comment on table public.cut30_creator_profiles is
  'Per-creator personalisation profiles used by the Cut30 lesson generator. Each row has a unique access_slug gating public form access. Profile is JSONB for schema flexibility.';
