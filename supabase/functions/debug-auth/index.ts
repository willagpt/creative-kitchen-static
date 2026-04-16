import "jsr:@supabase/functions-js/edge-runtime.d.ts";

Deno.serve(async (req: Request) => {
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
  return new Response(JSON.stringify({
    serviceKeyLength: serviceKey.length,
    serviceKeyPrefix: serviceKey.substring(0, 20),
    anonKeyLength: anonKey.length,
    anonKeyPrefix: anonKey.substring(0, 20),
    authHeader: req.headers.get("authorization")?.substring(0, 30) || "none",
    apikeyHeader: req.headers.get("apikey")?.substring(0, 30) || "none",
  }), { headers: { "Content-Type": "application/json" } });
});
