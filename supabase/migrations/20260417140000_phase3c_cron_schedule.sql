-- Migration: phase3c_cron_schedule
-- Phase 3c of Organic Intelligence: daily Instagram + twice-daily YouTube fetch schedule.
--
-- What this does
--   1. Installs pg_cron (pg_net is already installed).
--   2. Creates public._trigger_organic_platform(p_platform text), a SECURITY DEFINER
--      helper that reads the service role JWT from vault.decrypted_secrets
--      (secret name: 'organic_cron_service_key') and POSTs to the orchestrator
--      edge function `trigger-organic-fetches`.
--   3. Schedules three cron jobs (instagram 02:15 UTC daily, YouTube 06:30 + 18:30 UTC daily).
--   4. Disables all three jobs on ship. Operator must populate the vault secret and
--      flip `cron.job.active = true` to go live.
--
-- How to enable once keys have been rotated
--   -- 1. Store the project's service role JWT in vault:
--   -- select vault.create_secret('<SERVICE_ROLE_JWT>', 'organic_cron_service_key',
--   --   'Bearer token for trigger-organic-fetches cron helper');
--   -- (or update with vault.update_secret if it already exists)
--   --
--   -- 2. Enable the jobs:
--   -- update cron.job set active = true
--   -- where jobname in (
--   --   'organic_fetch_instagram_daily',
--   --   'organic_fetch_youtube_morning',
--   --   'organic_fetch_youtube_evening'
--   -- );
--   --
--   -- 3. Inspect runs:
--   -- select * from cron.job_run_details order by start_time desc limit 20;
--   -- select * from organic_fetch_log order by started_at desc limit 20;
--
-- How to disable in an emergency
--   update cron.job set active = false where jobname like 'organic_fetch_%';
--
-- Guard rails live in the orchestrator (per-run daily IG budget $1.00,
-- per-run monthly YT quota 8000 units). The underlying fetchers also
-- apply their own budget caps ($30/month IG, 10000/month YT) as a second line.

create extension if not exists pg_cron;

-- ---------------------------------------------------------------------------
-- Helper: _trigger_organic_platform
-- ---------------------------------------------------------------------------

create or replace function public._trigger_organic_platform(p_platform text)
returns bigint
language plpgsql
security definer
set search_path = public, extensions, vault
as $$
declare
  v_key text;
  v_request_id bigint;
begin
  if p_platform not in ('instagram', 'youtube') then
    raise exception 'platform must be instagram or youtube, got %', p_platform;
  end if;

  select decrypted_secret
    into v_key
    from vault.decrypted_secrets
   where name = 'organic_cron_service_key'
   limit 1;

  if v_key is null or length(v_key) = 0 then
    raise exception 'vault secret organic_cron_service_key not set. Populate before enabling cron.';
  end if;

  select net.http_post(
    url := 'https://ifrxylvoufncdxyltgqt.supabase.co/functions/v1/trigger-organic-fetches',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_key
    ),
    body := jsonb_build_object('platform', p_platform),
    timeout_milliseconds := 60000
  ) into v_request_id;

  return v_request_id;
end;
$$;

revoke all on function public._trigger_organic_platform(text) from public;
revoke all on function public._trigger_organic_platform(text) from anon;
revoke all on function public._trigger_organic_platform(text) from authenticated;
grant execute on function public._trigger_organic_platform(text) to service_role;

comment on function public._trigger_organic_platform(text) is
  'Phase 3c Organic Intel cron helper. Reads service role JWT from vault.decrypted_secrets (name=organic_cron_service_key) and POSTs to trigger-organic-fetches. SECURITY DEFINER so pg_cron (running as postgres) can read the vault. To enable live: vault.create_secret the JWT, then UPDATE cron.job SET active = true.';

-- ---------------------------------------------------------------------------
-- Schedule: wrap unschedule in DO so migration is idempotent.
-- ---------------------------------------------------------------------------

do $$
begin
  begin
    perform cron.unschedule('organic_fetch_instagram_daily');
  exception when others then null;
  end;
  begin
    perform cron.unschedule('organic_fetch_youtube_morning');
  exception when others then null;
  end;
  begin
    perform cron.unschedule('organic_fetch_youtube_evening');
  exception when others then null;
  end;
end;
$$;

select cron.schedule(
  'organic_fetch_instagram_daily',
  '15 2 * * *',
  $job$ select public._trigger_organic_platform('instagram'); $job$
);

select cron.schedule(
  'organic_fetch_youtube_morning',
  '30 6 * * *',
  $job$ select public._trigger_organic_platform('youtube'); $job$
);

select cron.schedule(
  'organic_fetch_youtube_evening',
  '30 18 * * *',
  $job$ select public._trigger_organic_platform('youtube'); $job$
);

-- Disabled on ship. Operator enables after key rotation + vault populate.
update cron.job
   set active = false
 where jobname in (
   'organic_fetch_instagram_daily',
   'organic_fetch_youtube_morning',
   'organic_fetch_youtube_evening'
 );
