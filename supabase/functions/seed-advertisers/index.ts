import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SEED_KEYWORDS = [
  "meal prep", "meal delivery", "recipe box", "meal kit",
  "healthy meals", "protein", "protein bars", "protein shake",
  "food delivery", "ready meals", "diet food", "vegan food",
  "keto meals", "low calorie meals", "organic food",
  "snack box", "smoothie", "fresh food", "frozen meals",
  "nutrition", "fitness food", "plant based", "gluten free",
  "food subscription", "cooking", "restaurant delivery",
  "grocery delivery", "supplements", "weight loss",
  "burrito", "pizza delivery", "sushi delivery",
  "coffee subscription", "tea subscription", "juice cleanse",
  "breakfast delivery", "lunch delivery", "dinner kit",
  "family meals", "batch cooking", "macro friendly",
];

const COUNTRIES = ["GB", "US"];

Deno.serve(async (req: Request) => {
  // Only allow POST
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "POST only" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  let metaToken: string;
  try {
    const body = await req.json();
    metaToken = body.meta_token;
    if (!metaToken) throw new Error("missing meta_token");
  } catch {
    return new Response(
      JSON.stringify({ error: "Send JSON body with meta_token" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  let totalDiscovered = 0;
  let totalUpserted = 0;
  const errors: string[] = [];

  for (const country of COUNTRIES) {
    for (const keyword of SEED_KEYWORDS) {
      try {
        const params = new URLSearchParams({
          access_token: metaToken,
          search_terms: keyword,
          ad_reached_countries: country,
          ad_type: "ALL",
          fields: "page_id,page_name,publisher_platforms,bylines",
          limit: "500",
          ad_active_status: "ALL",
        });

        const res = await fetch(
          `https://graph.facebook.com/v19.0/ads_archive?${params}`
        );

        if (!res.ok) {
          errors.push(`${keyword}/${country}: HTTP ${res.status}`);
          continue;
        }

        const data = await res.json();
        if (!data.data || data.data.length === 0) continue;

        // Extract unique pages
        const seen = new Map<string, any>();
        for (const ad of data.data) {
          if (!ad.page_id || seen.has(ad.page_id)) continue;
          const adCount = data.data.filter(
            (a: any) => a.page_id === ad.page_id
          ).length;
          const platforms = new Set<string>();
          data.data
            .filter((a: any) => a.page_id === ad.page_id)
            .forEach((a: any) => {
              if (a.publisher_platforms)
                a.publisher_platforms.forEach((p: string) => platforms.add(p));
            });

          seen.set(ad.page_id, {
            page_id: String(ad.page_id),
            page_name: ad.page_name || "Unknown",
            ad_count: adCount,
            platforms: Array.from(platforms),
            byline: ad.bylines?.[0] || "",
            country,
            last_seen_at: new Date().toISOString(),
          });
        }

        const rows = Array.from(seen.values());
        totalDiscovered += rows.length;

        // Upsert into Supabase
        const { error: upsertErr } = await supabase
          .from("advertisers")
          .upsert(rows, { onConflict: "page_id" });

        if (upsertErr) {
          errors.push(`${keyword}/${country}: upsert error: ${upsertErr.message}`);
        } else {
          totalUpserted += rows.length;
        }

        // Small delay to respect Meta rate limits
        await new Promise((r) => setTimeout(r, 200));
      } catch (err) {
        errors.push(`${keyword}/${country}: ${(err as Error).message}`);
      }
    }
  }

  return new Response(
    JSON.stringify({
      success: true,
      keywords_searched: SEED_KEYWORDS.length * COUNTRIES.length,
      total_discovered: totalDiscovered,
      total_upserted: totalUpserted,
      errors: errors.length > 0 ? errors : undefined,
    }),
    {
      headers: {
        "Content-Type": "application/json",
        Connection: "keep-alive",
      },
    }
  );
});
