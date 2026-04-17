-- cut30_runs: groups brand applications generated in a single run from a creator profile
-- Also links cut30_brand_applications to runs + creator profiles + stores structured JSON output

create table if not exists public.cut30_runs (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.cut30_creator_profiles(id) on delete cascade,
  brand_name text not null,
  scope text not null default 'chefly_priority',
  lesson_uuids uuid[] not null default '{}',
  status text not null default 'running' check (status in ('running','success','partial','error')),
  model text,
  total_lessons int not null default 0,
  success_count int not null default 0,
  error_count int not null default 0,
  error_message text,
  profile_snapshot jsonb,
  brand_dna_snapshot jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists idx_cut30_runs_profile on public.cut30_runs(profile_id);
create index if not exists idx_cut30_runs_created_at on public.cut30_runs(created_at desc);

alter table public.cut30_brand_applications
  add column if not exists run_id uuid references public.cut30_runs(id) on delete set null,
  add column if not exists profile_id uuid references public.cut30_creator_profiles(id) on delete set null,
  add column if not exists generated_json jsonb,
  add column if not exists status text not null default 'success',
  add column if not exists error_message text;

create index if not exists idx_cut30_brand_applications_run on public.cut30_brand_applications(run_id);
create index if not exists idx_cut30_brand_applications_profile on public.cut30_brand_applications(profile_id);

alter table public.cut30_runs enable row level security;
drop policy if exists "cut30_runs_all" on public.cut30_runs;
create policy "cut30_runs_all" on public.cut30_runs for all using (true) with check (true);

comment on table public.cut30_runs is 'Groups brand applications generated in a single run from a creator profile';
comment on column public.cut30_brand_applications.run_id is 'Optional link to the generation run that produced this application';
comment on column public.cut30_brand_applications.generated_json is 'Structured generation output (concept, shots, hooks, CTA, notes)';
