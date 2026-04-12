import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SUPABASE_URL = "https://ifrxylvoufncdxyltgqt.supabase.co";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const ANALYSE_FN_URL = `${SUPABASE_URL}/functions/v1/analyse-competitor-creatives`;

// v15: fuzzy dedup in mergeBatchResults, consolidation retry
const STEP1_BATCH_SIZE = 1;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const sbHeaders = {
  apikey: SUPABASE_SERVICE_KEY,
  Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
  "Content-Type": "application/json",
};

function jsonResp(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function updateJob(jobId: string, fields: Record<string, unknown>) {
  fields.updated_at = new Date().toISOString();
  await fetch(`${SUPABASE_URL}/rest/v1/analysis_jobs?id=eq.${jobId}`, {
    method: "PATCH", headers: { ...sbHeaders, Prefer: "return=minimal" },
    body: JSON.stringify(fields),
  });
}

async function updateImage(imageId: string, fields: Record<string, unknown>) {
  await fetch(`${SUPABASE_URL}/rest/v1/analysis_job_images?id=eq.${imageId}`, {
    method: "PATCH", headers: { ...sbHeaders, Prefer: "return=minimal" },
    body: JSON.stringify(fields),
  });
}

async function getJob(jobId: string): Promise<Record<string, unknown> | null> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/analysis_jobs?id=eq.${jobId}&select=*`, { headers: sbHeaders });
  const rows = await res.json();
  return rows[0] || null;
}

async function getJobImages(jobId: string, filter = ''): Promise<Array<Record<string, unknown>>> {
  const url = `${SUPABASE_URL}/rest/v1/analysis_job_images?job_id=eq.${jobId}${filter}&order=ad_index.asc`;
  const res = await fetch(url, { headers: sbHeaders });
  return res.ok ? await res.json() : [];
}

async function unstickProcessingImages(jobId: string) {
  const stuck = await getJobImages(jobId, '&step1_status=eq.processing');
  if (stuck.length > 0) {
    for (const img of stuck) {
      await updateImage(img.id as string, { step1_status: 'pending', step1_error: 'Auto-reset from stuck processing state' });
    }
  }
  return stuck.length;
}

async function findPriorAnalyses(imageUrls: string[], currentJobId: string): Promise<Map<string, Record<string, unknown>>> {
  const cache = new Map<string, Record<string, unknown>>();
  if (imageUrls.length === 0) return cache;
  for (const url of imageUrls) {
    try {
      const encoded = encodeURIComponent(url);
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/analysis_job_images?image_url=eq.${encoded}&step1_status=eq.completed&job_id=neq.${currentJobId}&order=created_at.desc&limit=1&select=step1_analysis,visual_cluster,creative_format`,
        { headers: sbHeaders }
      );
      if (res.ok) {
        const rows = await res.json();
        if (rows.length > 0 && rows[0].step1_analysis) cache.set(url, rows[0]);
      }
    } catch { /* skip */ }
  }
  return cache;
}

async function processNextStep1Batch(jobId: string): Promise<{ done: boolean; batchResult?: Record<string, unknown> }> {
  await unstickProcessingImages(jobId);
  const pending = await getJobImages(jobId, '&step1_status=eq.pending');
  if (pending.length === 0) return { done: true };

  const batch = pending.slice(0, STEP1_BATCH_SIZE);
  const batchIndex = Math.floor((batch[0].ad_index as number) / STEP1_BATCH_SIZE);

  for (const img of batch) {
    await updateImage(img.id as string, { step1_status: 'processing', step1_batch_index: batchIndex });
  }

  const ads = batch.map(img => ({
    imageUrl: img.image_url, title: img.headline || '', body: img.body_text || '',
    daysActive: img.days_active || 0, displayFormat: img.display_format || 'IMAGE',
    pageName: img.page_name || '', isVideo: false,
  }));

  const res = await fetch(ANALYSE_FN_URL, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ step: 1, ads }),
  });

  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    const errMsg = errBody.error || `Step 1 batch returned ${res.status}`;
    for (const img of batch) await updateImage(img.id as string, { step1_status: 'failed', step1_error: errMsg });
    const all = await getJobImages(jobId);
    await updateJob(jobId, { completed_step1: all.filter(i => i.step1_status === 'completed').length, error_message: `Batch ${batchIndex} failed: ${errMsg}` });
    return { done: all.filter(i => i.step1_status === 'pending').length === 0 };
  }

  const data = await res.json();
  if (data.error) {
    for (const img of batch) await updateImage(img.id as string, { step1_status: 'failed', step1_error: data.error });
    const all = await getJobImages(jobId);
    await updateJob(jobId, { completed_step1: all.filter(i => i.step1_status === 'completed').length, error_message: `Batch ${batchIndex} error: ${data.error}` });
    return { done: all.filter(i => i.step1_status === 'pending').length === 0 };
  }

  const analysis = data.analysis as Record<string, unknown>;
  const adAnalyses = (analysis.adAnalyses || []) as Array<Record<string, unknown>>;

  for (const adResult of adAnalyses) {
    const adIdx = (adResult.adIndex as number) || 0;
    const img = batch[adIdx - 1];
    if (img) {
      await updateImage(img.id as string, {
        step1_analysis: adResult, step1_status: 'completed', step1_batch_index: batchIndex,
        visual_cluster: adResult.visualCluster || null,
        creative_format: adResult.creativeFormat || null,
      });
    }
  }

  for (let i = 0; i < batch.length; i++) {
    if (!adAnalyses.find(a => (a.adIndex as number) === i + 1)) {
      await updateImage(batch[i].id as string, { step1_status: 'failed', step1_error: 'No analysis returned for this image' });
    }
  }

  const all = await getJobImages(jobId);
  await updateJob(jobId, { completed_step1: all.filter(i => i.step1_status === 'completed').length });
  return { done: all.filter(i => i.step1_status === 'pending').length === 0, batchResult: analysis };
}

async function runConsolidation(jobId: string): Promise<{ success: boolean; error?: string }> {
  const job = await getJob(jobId);
  if (!job) return { success: false, error: 'Job not found' };

  const themes = (job.merged_themes || []) as unknown[];
  const personas = (job.merged_personas || []) as unknown[];
  const pillars = (job.merged_pillars || []) as unknown[];
  const clusters = (job.merged_clusters || []) as unknown[];
  const formats = (job.merged_formats || []) as unknown[];
  const totalImages = (job.total_images as number) || 0;

  console.log(`[v15] Pre-consolidation counts: ${themes.length} themes, ${personas.length} personas, ${pillars.length} pillars, ${clusters.length} clusters, ${formats.length} formats`);

  const allImages = await getJobImages(jobId, '&step1_status=eq.completed');
  const imageMetadata = allImages.map(img => ({
    ad_index: img.ad_index,
    page_name: img.page_name || 'Unknown',
    visual_cluster: img.visual_cluster || 'Unclustered',
    creative_format: img.creative_format || 'Unknown',
    days_active: img.days_active || 0,
    headline: (img.headline as string || '').slice(0, 80),
    display_format: img.display_format || 'IMAGE',
  }));

  const res = await fetch(ANALYSE_FN_URL, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      step: 1.5,
      themes, personas, pillars, clusters, formats,
      total_ads: totalImages,
      image_metadata: imageMetadata,
    }),
  });

  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    return { success: false, error: errBody.error || `Consolidation returned ${res.status}` };
  }

  const data = await res.json();
  if (data.error) return { success: false, error: data.error };

  const c = data.consolidated as Record<string, unknown>;
  if (!c) return { success: false, error: 'No consolidated data returned' };

  console.log(`[v15] Post-consolidation counts: ${(c.themes as unknown[] || []).length} themes, ${(c.personas as unknown[] || []).length} personas, ${(c.creativePillars as unknown[] || []).length} pillars, ${(c.visualClusters as unknown[] || []).length} clusters`);

  await updateJob(jobId, {
    merged_themes: c.themes || themes,
    merged_personas: c.personas || personas,
    merged_pillars: c.creativePillars || pillars,
    merged_clusters: c.visualClusters || clusters,
    merged_formats: c.creativeFormats || formats,
    consolidation_summary: c.consolidationSummary || null,
  });

  return { success: true };
}

// v15: Fuzzy name similarity for deduplication
function normalizeName(name: string): string {
  return name.toLowerCase()
    .replace(/^the\s+/i, '')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function getWords(name: string): Set<string> {
  const stopWords = new Set(['the', 'a', 'an', 'and', 'or', 'of', 'for', 'in', 'on', 'to', 'with', 'by', 'is', 'as']);
  return new Set(
    normalizeName(name).split(' ').filter(w => w.length > 2 && !stopWords.has(w))
  );
}

function nameSimilarity(a: string, b: string): number {
  const normA = normalizeName(a);
  const normB = normalizeName(b);
  // Exact match after normalization
  if (normA === normB) return 1.0;
  const wordsA = getWords(a);
  const wordsB = getWords(b);
  if (wordsA.size === 0 || wordsB.size === 0) return 0;
  const intersection = new Set([...wordsA].filter(w => wordsB.has(w)));
  const union = new Set([...wordsA, ...wordsB]);
  return intersection.size / union.size; // Jaccard index
}

// deno-lint-ignore no-explicit-any
function mergeItems(items: any[], threshold = 0.5): { group: string; items: any[] }[] {
  const groups: { group: string; items: any[] }[] = [];
  const processed = new Set<number>();

  for (let i = 0; i < items.length; i++) {
    if (processed.has(i)) continue;
    const group = items[i].name || items[i];
    const members = [items[i]];
    processed.add(i);

    for (let j = i + 1; j < items.length; j++) {
      if (processed.has(j)) continue;
      const candidate = items[j];
      const sim = nameSimilarity(group, candidate.name || candidate);
      if (sim >= threshold) {
        members.push(candidate);
        processed.add(j);
      }
    }
    groups.push({ group, items: members });
  }
  return groups;
}

// deno-lint-ignore no-explicit-any
function consolidateGroup(group: { group: string; items: any[] }): any {
  const items = group.items;
  if (items.length === 0) return null;
  const first = items[0];
  if (typeof first === 'string') return first;

  const result = { ...first };
  if (items.length > 1) {
    result.count = items.length;
    if (Array.isArray(result.brands)) {
      const allBrands = new Set<string>();
      items.forEach((i: any) => {
        if (i.brands && Array.isArray(i.brands)) i.brands.forEach((b: string) => allBrands.add(b));
      });
      result.brands = Array.from(allBrands);
    }
  }
  return result;
}

// deno-lint-ignore no-explicit-any
function fuzzyDedup(items: any[], threshold = 0.5): any[] {
  const groups = mergeItems(items, threshold);
  return groups.map(consolidateGroup).filter(Boolean);
}

// deno-lint-ignore no-explicit-any
function mergeBatchResults(batch: any[], threshold = 0.5): any {
  if (!batch || batch.length === 0) return null;
  if (batch.length === 1) return batch[0];

  const mergedThemes = fuzzyDedup(
    batch.flatMap((b: any) => b.themes || []),
    threshold
  );
  const mergedPersonas = fuzzyDedup(
    batch.flatMap((b: any) => b.personas || []),
    threshold
  );
  const mergedPillars = fuzzyDedup(
    batch.flatMap((b: any) => b.creativePillars || []),
    threshold
  );
  const mergedClusters = fuzzyDedup(
    batch.flatMap((b: any) => b.visualClusters || []),
    threshold
  );
  const mergedFormats = fuzzyDedup(
    batch.flatMap((b: any) => b.creativeFormats || []),
    threshold
  );

  return {
    themes: mergedThemes,
    personas: mergedPersonas,
    creativePillars: mergedPillars,
    visualClusters: mergedClusters,
    creativeFormats: mergedFormats,
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const { action, jobId } = await req.json();

    if (action === 'create') {
      const { total_images } = await req.json();
      const res = await fetch(`${SUPABASE_URL}/rest/v1/analysis_jobs`, {
        method: 'POST',
        headers: sbHeaders,
        body: JSON.stringify({
          total_images,
          step1_status: 'pending',
          completed_step1: 0,
        }),
      });
      const job = await res.json();
      return jsonResp(job[0]);
    }

    if (action === 'process_next') {
      const result = await processNextStep1Batch(jobId);
      return jsonResp(result);
    }

    if (action === 'reconsolidate') {
      const result = await runConsolidation(jobId);
      return jsonResp(result);
    }

    if (action === 'status') {
      const job = await getJob(jobId);
      return jsonResp(job);
    }

    if (action === 'results') {
      const job = await getJob(jobId);
      if (!job) return jsonResp({ error: 'Job not found' }, 404);
      return jsonResp({
        job,
        themes: job.merged_themes || [],
        personas: job.merged_personas || [],
        pillars: job.merged_pillars || [],
        clusters: job.merged_clusters || [],
        formats: job.merged_formats || [],
      });
    }

    if (action === 'list_completed') {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/analysis_jobs?step1_status=eq.completed&order=created_at.desc&limit=50`,
        { headers: sbHeaders }
      );
      const jobs = await res.json();
      return jsonResp(jobs);
    }

    return jsonResp({ error: 'Unknown action' }, 400);
  } catch (err) {
    return jsonResp({ error: String(err) }, 500);
  }
});
