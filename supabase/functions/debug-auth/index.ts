import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// RETIRED 16 April 2026.
// This diagnostic function is being decommissioned. It previously returned
// prefixes of Supabase service/anon keys for auth header debugging, which
// is not appropriate for a long-lived deployed endpoint.
//
// Retirement plan:
//   1. This revision short-circuits all requests with HTTP 410 Gone.
//   2. Once we confirm no callers hit this endpoint for 7 days, the function
//      will be removed from the project entirely (Supabase Dashboard -> Edge
//      Functions -> Delete).
//   3. Source will be removed from `supabase/functions/debug-auth/` in the
//      same follow-up change.
//
// Tracking ticket: Asana - "Phase 2: hard-delete debug-auth edge function".

Deno.serve((_req: Request) => {
  return new Response(
    JSON.stringify({
      error: "Gone",
      message: "debug-auth has been retired. Contact the engineering team if you need diagnostic access.",
      retired_on: "2026-04-16",
    }),
    {
      status: 410,
      headers: { "Content-Type": "application/json" },
    },
  );
});
