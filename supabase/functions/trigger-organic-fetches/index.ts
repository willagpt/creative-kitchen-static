// Supabase Edge Function: trigger-organic-fetches
//
// Phase 3c orchestrator. Invoked by pg_cron (via pg_net + vault-stored service
// role JWT) on a schedule. Reads `followed_organic_accounts`, applies budget
// and idle-threshold guards, then dispatches to `fetch-instagram-posts` or
// `fetch-youtube-posts` for each due account in async mode (202 + log_id).
//
// Why async dispatch
// ------------------
// The previous implementation awaited each per-account fetch in series, with
// a 30s stagger. A single slow account (e.g. a busy IG handle that takes
// >150s to scrape) would tip the entire orchestrator past the Supabase
// gateway's 150s wall, returning 504 and leaving the rest of the queue
// un-dispatched. Async dispatch flips the model: each fetcher returns 202
// in <1s with a log_id, and the heavy work runs inside the fetcher's own
// EdgeRuntime.waitUntil. The orchestrator now finishes a 50-account batch in
// well under 30s and never blocks on a single slow handle.
//
// Request shape (POST, JSON):
//   { platform: "instagram" | "youtube",
//     idle_hours?: number,           // override per-platform default
//     limit_per_account?: number,    // override fetcher default
//     stagger_ms?: number = 250,     // small delay between dispatches
//     max_accounts?: number,         // safety cap per run
//     dry_run?: boolean = false }    // plan only, no side effects
//
// Defaults per platform:
//   instagram: idle_hours=20, limit_per_account=50, daily budget_usd=1.00
//   youtube:   idle_hours=11, limit_per_account=20, monthly quota=8000 units
//
// Guard logic (pre-flight, before any dispatch):
//   - instagram: sum(cost_estimate) from organic_fetch_log where
//     platform='instagram' AND started_at >= date_trunc('day', now() at time zone 'utc').
//     If >= 1.00 USD, abort with status 'budget_exhausted'.
//   - youtube: sum(yt_quota_units) from organic_fetch_log where
//     platform='youtube' AND started_at >= date_trunc('month', now() at time zone 'utc').
//     If >= 8000 units, abort with status 'quota_exhausted'.
//
// Idle threshold:
//   Process an account only if last_fetched_at IS NULL OR
//   last_fetched_at < now() - interval 'idle_hours hours'.
//
// Error policy:
//   The orchestrator only verifies the dispatch ack (202). The heavy work
//   completing or failing is reflected in organic_fetch_log by the fetcher
//   itself. If a fetcher returns a non-2xx ack (auth, account-not-found,
//   budget-exceeded), we record it as a dispatch failure but keep going.
//
// Security:
//   verify_jwt: true. Cron passes the service role JWT from vault as Bearer.
//   Manual runs require a signed-in user or the same service role token.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SUPABASE_URL = "https://ifrxylvoufncdxyltgqt.supabase.co";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
// Optional override: explicit legacy JWT for function-to-function dispatch.
// When Supabase auto-injects SUPABASE_SERVICE_ROLE_KEY in the modern
// `sb_secret_...` format, PostgREST accepts it via the `apikey` header, but
// the edge-function gateway (verify_jwt: true) rejects it because it is not
// a JWT. Set ORG_CRON_SERVICE_KEY to a legacy service-role JWT to unblock,
// or rely on the incoming Authorization header fallback below.
const DISPATCH_JWT = Deno.env.get("ORG_CRON_SERVICE_KEY") || "";

const FUNCTION_VERSION = "trigger-organic-fetches@1.2.0";

const IG_DEFAULTS = {
  idleHours: 20,
  limitPerAccount: 50,
  dailyBudgetUsd: 1.00,
  fetcherPath: "fetch-instagram-posts",
};

const YT_DEFAULTS = {
  idleHours: 11,
  limitPerAccount: 20,
  monthlyQuotaUnits: 8000,
  fetcherPath: "fetch-youtube-posts",
};

// With async dispatch the fetcher returns in ~1s, so the only reason for
// stagger is to avoid hammering the gateway with simultaneous bursts.
const DEFAULT_STAGGER_MS = 250;
const DEFAULT_MAX_ACCOUNTS = 50;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Expose-Headers": "X-Function-Version",
};

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
      "X-Function-Version": FUNCTION_VERSION,
    },
  });
}

interface AccountRow {
  id: string;
  platform: string;
  handle: string;
  brand_name: string;
  is_active: boolean;
  last_fetched_at: string | null;
}

interface DispatchResult {
  account_id: string;
  handle: string;
  ok: boolean;
  http_status: number;
  log_id?: string;
  error?: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pgGet(path: string): Promise<any> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      "Accept": "application/json",
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`PostgREST ${path} ${res.status}: ${text.slice(0, 300)}`);
  }
  return res.json();
}

async function fetchBudgetGuard(platform: string): Promise<{ used: number; unit: "usd" | "units" }> {
  const now = new Date();
  let sinceIso: string;
  if (platform === "instagram") {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    sinceIso = d.toISOString();
  } else {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    sinceIso = d.toISOString();
  }
  const col = platform === "instagram" ? "cost_estimate" : "yt_quota_units";
  const rows = await pgGet(
    `organic_fetch_log?select=${col}&platform=eq.${platform}&started_at=gte.${encodeURIComponent(sinceIso)}`,
  );
  let used = 0;
  for (const r of rows) {
    const v = Number((r as any)[col]);
    if (!Number.isNaN(v)) used += v;
  }
  return { used, unit: platform === "instagram" ? "usd" : "units" };
}

async function fetchDueAccounts(platform: string, idleHours: number, maxAccounts: number): Promise<AccountRow[]> {
  const rows = await pgGet(
    `followed_organic_accounts?select=id,platform,handle,brand_name,is_active,last_fetched_at&platform=eq.${platform}&is_active=eq.true&order=handle.asc`,
  );
  const cutoff = Date.now() - idleHours * 60 * 60 * 1000;
  const due: AccountRow[] = [];
  for (const r of rows as AccountRow[]) {
    if (r.last_fetched_at === null) {
      due.push(r);
      continue;
    }
    const t = Date.parse(r.last_fetched_at);
    if (!Number.isNaN(t) && t < cutoff) due.push(r);
  }
  return due.slice(0, maxAccounts);
}

async function dispatchFetcher(
  fetcherPath: string,
  payload: Record<string, unknown>,
  dispatchAuth: string,
): Promise<{ ok: boolean; http_status: number; body: any }> {
  // `dispatchAuth` is a full Authorization header value (e.g. "Bearer eyJ...").
  // Mirror it into the `apikey` header too because Supabase gateway checks both.
  const token = dispatchAuth.toLowerCase().startsWith("bearer ")
    ? dispatchAuth.slice(7).trim()
    : dispatchAuth.trim();
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${fetcherPath}`, {
    method: "POST",
    headers: {
      apikey: token,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    // Always async=true: we only need the dispatch ack here, the heavy work
    // runs in the fetcher's EdgeRuntime.waitUntil and surfaces via
    // organic_fetch_log.
    body: JSON.stringify({ ...payload, async: true }),
  });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, http_status: res.status, body };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "method not allowed" }, 405);
  }

  if (!SUPABASE_SERVICE_KEY) {
    return jsonResponse({ error: "SUPABASE_SERVICE_ROLE_KEY not configured" }, 500);
  }

  const incomingAuth = req.headers.get("Authorization") || "";
  const dispatchAuth = DISPATCH_JWT
    ? `Bearer ${DISPATCH_JWT}`
    : incomingAuth;
  if (!dispatchAuth) {
    return jsonResponse({ error: "no Authorization header and ORG_CRON_SERVICE_KEY not set" }, 401);
  }

  let body: any = {};
  try {
    body = await req.json();
  } catch (_) {
    body = {};
  }

  const platform = String(body.platform || "").toLowerCase();
  if (platform !== "instagram" && platform !== "youtube") {
    return jsonResponse({ error: "platform must be 'instagram' or 'youtube'" }, 400);
  }

  const cfg = platform === "instagram" ? IG_DEFAULTS : YT_DEFAULTS;
  const idleHours = Number.isFinite(Number(body.idle_hours)) ? Number(body.idle_hours) : cfg.idleHours;
  const limitPerAccount = Number.isFinite(Number(body.limit_per_account))
    ? Number(body.limit_per_account)
    : cfg.limitPerAccount;
  const staggerMs = Number.isFinite(Number(body.stagger_ms)) ? Number(body.stagger_ms) : DEFAULT_STAGGER_MS;
  const maxAccounts = Number.isFinite(Number(body.max_accounts)) ? Number(body.max_accounts) : DEFAULT_MAX_ACCOUNTS;
  const dryRun = body.dry_run === true;

  const startedAt = new Date().toISOString();

  try {
    const budget = await fetchBudgetGuard(platform);
    const budgetCap = platform === "instagram"
      ? IG_DEFAULTS.dailyBudgetUsd
      : YT_DEFAULTS.monthlyQuotaUnits;
    const budgetExhausted = budget.used >= budgetCap;

    const due = await fetchDueAccounts(platform, idleHours, maxAccounts);

    if (dryRun || budgetExhausted) {
      return jsonResponse({
        status: budgetExhausted ? (platform === "instagram" ? "budget_exhausted" : "quota_exhausted") : "dry_run",
        platform,
        started_at: startedAt,
        budget_used: budget.used,
        budget_cap: budgetCap,
        budget_unit: budget.unit,
        idle_hours: idleHours,
        due_count: due.length,
        due_accounts: due.map((a) => ({ id: a.id, handle: a.handle, brand_name: a.brand_name, last_fetched_at: a.last_fetched_at })),
        stagger_ms: staggerMs,
        dispatched: 0,
        succeeded: 0,
        failed: 0,
      });
    }

    const results: DispatchResult[] = [];
    let succeeded = 0;
    let failed = 0;

    for (let i = 0; i < due.length; i++) {
      const acc = due[i];
      try {
        const { ok, http_status, body: respBody } = await dispatchFetcher(
          cfg.fetcherPath,
          {
            handle: acc.handle,
            mode: "fetch",
            limit: limitPerAccount,
          },
          dispatchAuth,
        );
        // Async fetcher returns 202 with status: "accepted" on a successful
        // dispatch. Treat both 202 and any 2xx as a successful enqueue.
        const dispatched = http_status >= 200 && http_status < 300;
        const row: DispatchResult = {
          account_id: acc.id,
          handle: acc.handle,
          ok: dispatched,
          http_status,
        };
        if (dispatched) {
          succeeded++;
          if (respBody && typeof respBody === "object" && typeof respBody.log_id === "string") {
            row.log_id = respBody.log_id;
          }
        } else {
          failed++;
          row.error = respBody?.error || `fetcher returned ${http_status}`;
        }
        results.push(row);
      } catch (e) {
        failed++;
        results.push({
          account_id: acc.id,
          handle: acc.handle,
          ok: false,
          http_status: 0,
          error: e instanceof Error ? e.message : String(e),
        });
      }

      if (i < due.length - 1 && staggerMs > 0) {
        await sleep(staggerMs);
      }
    }

    return jsonResponse({
      status: "complete",
      platform,
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      budget_used: budget.used,
      budget_cap: budgetCap,
      budget_unit: budget.unit,
      idle_hours: idleHours,
      due_count: due.length,
      dispatched: results.length,
      succeeded,
      failed,
      stagger_ms: staggerMs,
      note: "Heavy work runs asynchronously in each fetcher's EdgeRuntime.waitUntil. Poll organic_fetch_log by log_id for completion.",
      results,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return jsonResponse({
      status: "error",
      platform,
      started_at: startedAt,
      error: message,
    }, 500);
  }
});
