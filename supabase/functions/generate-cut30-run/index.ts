// POST /functions/v1/generate-cut30-run
// Generate Cut30 brand applications for a creator profile (slug-gated).
// v1.0.0: kick off a run across Chefly-priority lessons, call Claude per lesson,
// store in cut30_brand_applications, update cut30_runs status.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
};

const MODEL = "claude-sonnet-4-6";
const SUPABASE_URL = "https://ifrxylvoufncdxyltgqt.supabase.co";

type Lesson = {
  id: string;
  lesson_id: string;
  module: string;
  title: string;
  summary: string | null;
  body_md: string;
  chefly_priority: string | null;
  frameworks_introduced: string | null;
  tags: string[] | null;
};

type Profile = {
  id: string;
  creator_name: string;
  brand_name: string;
  access_slug: string;
  profile: Record<string, unknown>;
  status: string;
  completion_percent: number;
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function sbHeaders(serviceKey: string) {
  return {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    "Content-Type": "application/json",
  };
}

async function callClaude(apiKey: string, system: string, user: string): Promise<{ text: string; stop_reason: string; usage: any }> {
  let lastErr = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: 4096,
          system,
          messages: [{ role: "user", content: user }],
        }),
      });
      if (resp.status === 429 || resp.status === 529 || resp.status >= 500) {
        lastErr = `HTTP ${resp.status}`;
        await new Promise((r) => setTimeout(r, Math.pow(2, attempt) * 1200));
        continue;
      }
      if (!resp.ok) {
        const t = await resp.text();
        throw new Error(`Claude ${resp.status}: ${t.slice(0, 200)}`);
      }
      const data = await resp.json();
      const block = data.content?.[0];
      if (!block || block.type !== "text") throw new Error("No text block in Claude response");
      return { text: block.text, stop_reason: data.stop_reason, usage: data.usage };
    } catch (e) {
      lastErr = String(e);
      if (attempt === 2) throw new Error(lastErr);
    }
  }
  throw new Error(lastErr || "Claude failed");
}

function stripFences(raw: string): string {
  let s = raw.trim();
  if (s.startsWith("```json")) s = s.slice(7);
  else if (s.startsWith("```")) s = s.slice(3);
  if (s.endsWith("```")) s = s.slice(0, -3);
  return s.trim();
}

function buildSystem(): string {
  return `You are a senior content strategist applying Cut30 lessons to a specific creator's profile and brand.

Cut30 is a short-form video content course. A "brand application" is the concrete, actionable output a creator and brand should produce from a given Cut30 lesson — tailored to the creator's voice, story, preferences, and the brand's product/positioning.

You will receive:
1. One Cut30 lesson (full markdown body)
2. The creator's profile (identity, voice, story, aesthetic, interests, platforms, operations, no-gos, swipe file, food knowledge)
3. The brand's DNA (product, packaging, positioning)

Your job: produce a structured application that the creator could execute THIS WEEK. Respect no-go topics. Stay in the creator's voice. Reference specific details from the profile (catchphrases, upbringing, past lives, swipe creators) so the output feels personal.

Output ONLY valid JSON. No markdown fences. No preamble. Match the exact schema requested.`;
}

function buildUser(lesson: Lesson, profile: Profile, brandDna: any): string {
  const p = profile.profile || {};
  // Truncate lesson body if extremely long to stay well within context
  const body = (lesson.body_md || "").slice(0, 8000);
  return `# CUT30 LESSON
**Lesson:** ${lesson.title}
**Module:** ${lesson.module}
**Chefly priority:** ${lesson.chefly_priority || "standard"}

\`\`\`md
${body}
\`\`\`

# CREATOR PROFILE — ${profile.creator_name} (${profile.brand_name})
${JSON.stringify(p, null, 2)}

# BRAND DNA — ${profile.brand_name}
${JSON.stringify(brandDna || {}, null, 2)}

# REQUESTED OUTPUT (strict JSON, no markdown fences)
{
  "headline": "one-line concept that nails the application for this creator + brand",
  "why_it_fits": "2-3 sentences citing specific profile details (past life, voice, catchphrase, swipe creator, etc.) — why this lesson's framework plays to THIS creator",
  "format_or_playbook": "the format/playbook/exercise/homework distilled into a durable shape the creator can repeat",
  "this_week_actions": [
    "3 to 5 concrete actions the creator could do this week. Reference her film_days, locations, gear, sustainable_weekly load. Be specific, not generic."
  ],
  "shot_ideas": [
    {
      "title": "short punchy shot title",
      "hook_line": "exact words she says 0-3s, in her voice (use her catchphrases naturally if they fit, no forced vulgarity if profile says avoid)",
      "beats": ["3 to 5 short beat descriptions with approximate seconds, e.g. '0-3s: hook, camera close on sleeve', '3-10s: cutaway of fire-grill shot', etc."],
      "on_screen_text": ["array of overlays if used, or []"],
      "cta_line": "one-line CTA in her voice",
      "length_seconds": 15,
      "filming_location": "one of her listed locations",
      "variation_note": "how this variation differs from the others"
    }
  ],
  "scripts_count_note": "How many scripts are in shot_ideas and why that count fits this lesson",
  "personal_hooks_to_mine": ["5 bullet prompts from her profile she could turn into content — specific past-life moments, opinions, obsessions"],
  "pitfalls_to_avoid": ["2 to 4 things she must NOT do given her no-go list and voice preferences"],
  "success_signal": "what a good version of this content should feel or look like for THIS creator (one sentence)"
}

Rules:
- Produce between 2 and 4 shot_ideas (pick a count that fits the lesson's content type).
- Keep hook lines sharp and in her voice; she uses "Amazing!", "So Good!" and has a deep, warm, meditative voice ("The Voice").
- Don't suggest sex/race/age content, gossip, political arguments, or vulgarity beyond what her profile allows.
- Prefer morning filming, Wed/Thu/Fri; locations she listed.
- Reference specific elements of her past_lives, upbringing, interests, obsessions where relevant.
- Output ONLY the JSON object. Nothing else.`;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("OK", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const slug: string = body.slug || "";
  const lessonUuids: string[] = Array.isArray(body.lesson_ids) ? body.lesson_ids : [];
  const scope: string = body.scope || "chefly_priority"; // chefly_priority | all | custom
  const limit: number = typeof body.limit === "number" ? Math.max(1, Math.min(25, body.limit)) : 14;
  const concurrency: number = typeof body.concurrency === "number" ? Math.max(1, Math.min(6, body.concurrency)) : 4;

  if (!slug) return json({ error: "slug required" }, 400);

  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const claudeKey = Deno.env.get("CLAUDE_API_KEY") || Deno.env.get("ANTHROPIC_API_KEY") || "";
  if (!serviceKey || !claudeKey) return json({ error: "Server configuration error" }, 500);

  const dbH = sbHeaders(serviceKey);

  // 1. Load profile by slug
  const profRes = await fetch(
    `${SUPABASE_URL}/rest/v1/cut30_creator_profiles?access_slug=eq.${encodeURIComponent(slug)}&select=*`,
    { headers: dbH }
  );
  if (!profRes.ok) return json({ error: "Profile lookup failed", details: await profRes.text() }, 500);
  const profArr = await profRes.json();
  if (!profArr?.length) return json({ error: "Profile not found" }, 404);
  const profile: Profile = profArr[0];

  // 2. Load brand guidelines
  const brandRes = await fetch(
    `${SUPABASE_URL}/rest/v1/brand_guidelines?brand_name=ilike.${encodeURIComponent(profile.brand_name)}&select=*`,
    { headers: dbH }
  );
  const brandArr = brandRes.ok ? await brandRes.json() : [];
  const brandDna = brandArr?.[0] || { brand_name: profile.brand_name };

  // 3. Load target lessons
  let lessonQuery: string;
  if (lessonUuids.length) {
    const ids = lessonUuids.map((u) => `"${u}"`).join(",");
    lessonQuery = `${SUPABASE_URL}/rest/v1/cut30_lessons?id=in.(${ids})&select=id,lesson_id,module,title,summary,body_md,chefly_priority,frameworks_introduced,tags`;
  } else if (scope === "all") {
    lessonQuery = `${SUPABASE_URL}/rest/v1/cut30_lessons?select=id,lesson_id,module,title,summary,body_md,chefly_priority,frameworks_introduced,tags&limit=${limit}`;
  } else {
    // chefly_priority (default)
    lessonQuery = `${SUPABASE_URL}/rest/v1/cut30_lessons?chefly_priority=not.is.null&select=id,lesson_id,module,title,summary,body_md,chefly_priority,frameworks_introduced,tags&order=chefly_priority.asc&limit=${limit}`;
  }
  const lessonsRes = await fetch(lessonQuery, { headers: dbH });
  if (!lessonsRes.ok) return json({ error: "Lesson lookup failed", details: await lessonsRes.text() }, 500);
  const lessons: Lesson[] = await lessonsRes.json();
  if (!lessons?.length) return json({ error: "No lessons matched scope" }, 404);

  // 4. Create run row
  const runInsertRes = await fetch(`${SUPABASE_URL}/rest/v1/cut30_runs`, {
    method: "POST",
    headers: { ...dbH, Prefer: "return=representation" },
    body: JSON.stringify([{
      profile_id: profile.id,
      brand_name: profile.brand_name,
      scope,
      lesson_uuids: lessons.map((l) => l.id),
      status: "running",
      model: MODEL,
      total_lessons: lessons.length,
      profile_snapshot: profile.profile,
      brand_dna_snapshot: brandDna,
    }]),
  });
  if (!runInsertRes.ok) return json({ error: "Run create failed", details: await runInsertRes.text() }, 500);
  const runRow = (await runInsertRes.json())[0];
  const runId: string = runRow.id;

  const system = buildSystem();

  // 5. Process lessons with a concurrency gate
  let successCount = 0;
  let errorCount = 0;
  const results: any[] = [];

  async function processLesson(lesson: Lesson) {
    try {
      const userPrompt = buildUser(lesson, profile, brandDna);
      const { text, stop_reason } = await callClaude(claudeKey, system, userPrompt);
      if (stop_reason === "max_tokens") throw new Error("Truncated (max_tokens)");

      let parsed: any;
      try {
        parsed = JSON.parse(stripFences(text));
      } catch (e) {
        throw new Error(`JSON parse failed: ${String(e).slice(0, 120)}`);
      }

      const humanSummary = parsed.headline
        ? `${parsed.headline}\n\n${parsed.why_it_fits || ""}`
        : text.slice(0, 1000);

      const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/cut30_brand_applications`, {
        method: "POST",
        headers: { ...dbH, Prefer: "return=minimal" },
        body: JSON.stringify([{
          run_id: runId,
          profile_id: profile.id,
          brand_name: profile.brand_name,
          asset_type: "lesson",
          asset_id: lesson.id,
          generated_idea: humanSummary,
          generated_json: parsed,
          brand_dna_snapshot: brandDna,
          created_by: `edge:generate-cut30-run@1.0.0`,
          status: "success",
        }]),
      });
      if (!insertRes.ok) throw new Error(`Insert failed: ${await insertRes.text()}`);

      successCount++;
      results.push({ lesson_id: lesson.lesson_id, status: "success", headline: parsed.headline });
    } catch (e) {
      errorCount++;
      const msg = String(e).slice(0, 500);
      // Still record the failure so we have visibility
      await fetch(`${SUPABASE_URL}/rest/v1/cut30_brand_applications`, {
        method: "POST",
        headers: { ...dbH, Prefer: "return=minimal" },
        body: JSON.stringify([{
          run_id: runId,
          profile_id: profile.id,
          brand_name: profile.brand_name,
          asset_type: "lesson",
          asset_id: lesson.id,
          generated_idea: null,
          generated_json: null,
          brand_dna_snapshot: brandDna,
          created_by: `edge:generate-cut30-run@1.0.0`,
          status: "error",
          error_message: msg,
        }]),
      }).catch(() => {});
      results.push({ lesson_id: lesson.lesson_id, status: "error", error: msg });
    }
  }

  // Simple concurrency pool
  const queue = [...lessons];
  const workers: Promise<void>[] = [];
  for (let i = 0; i < Math.min(concurrency, lessons.length); i++) {
    workers.push((async () => {
      while (queue.length) {
        const l = queue.shift();
        if (!l) return;
        await processLesson(l);
      }
    })());
  }
  await Promise.all(workers);

  // 6. Finalise run
  const finalStatus = errorCount === 0 ? "success" : (successCount === 0 ? "error" : "partial");
  await fetch(`${SUPABASE_URL}/rest/v1/cut30_runs?id=eq.${runId}`, {
    method: "PATCH",
    headers: { ...dbH, Prefer: "return=minimal" },
    body: JSON.stringify({
      status: finalStatus,
      success_count: successCount,
      error_count: errorCount,
      completed_at: new Date().toISOString(),
    }),
  });

  return json({
    run_id: runId,
    status: finalStatus,
    total: lessons.length,
    success_count: successCount,
    error_count: errorCount,
    results,
  });
});
