import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SUPABASE_URL = "https://ifrxylvoufncdxyltgqt.supabase.co";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const ANALYSE_FN_URL = `${SUPABASE_URL}/functions/v1/analyse-competitor-creatives`;

// v16: fix cache reuse (rebuild merged fields), add auth to fn-to-fn calls
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

// Headers for calling other edge functions (service key auth)
const fnCallHeaders = {
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
    method: "POST", headers: fnCallHeaders,
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
    method: "POST", headers: fnCallHeaders,
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
  // One contains the other
  if (normA.includes(normB) || normB.includes(normA)) return 0.85;
  // Word overlap (Jaccard)
  const wordsA = getWords(a);
  const wordsB = getWords(b);
  if (wordsA.size === 0 || wordsB.size === 0) return 0;
  let intersection = 0;
  for (const w of wordsA) { if (wordsB.has(w)) intersection++; }
  const union = new Set([...wordsA, ...wordsB]).size;
  return intersection / union;
}

function mergeItems(existing: Record<string, unknown>, incoming: Record<string, unknown>): Record<string, unknown> {
  // Keep the longer/richer description
  const exDesc = (existing.description as string || '');
  const inDesc = (incoming.description as string || '');
  const merged = { ...existing };
  if (inDesc.length > exDesc.length) merged.description = inDesc;
  // Merge adIndices
  const exIdx = (existing.adIndices as number[]) || (existing.exampleAdIndices as number[]) || [];
  const inIdx = (incoming.adIndices as number[]) || (incoming.exampleAdIndices as number[]) || [];
  merged.adIndices = [...new Set([...exIdx, ...inIdx])];
  if (existing.exampleAdIndices) merged.exampleAdIndices = merged.adIndices;
  // Merge painPoints for personas
  if (existing.painPoints || incoming.painPoints) {
    merged.painPoints = [...new Set([...((existing.painPoints as string[]) || []), ...((incoming.painPoints as string[]) || [])])];
  }
  // Keep best whyItWorks
  if (incoming.whyItWorks && ((incoming.whyItWorks as string).length > ((existing.whyItWorks as string) || '').length)) {
    merged.whyItWorks = incoming.whyItWorks;
  }
  return merged;
}

// v15: Fuzzy-dedup an array of named items. Threshold 0.5 = merge if 50%+ word overlap.
function fuzzyDedup(items: unknown[], threshold = 0.5): unknown[] {
  if (items.length <= 1) return items;
  const result: Record<string, unknown>[] = [];
  const used = new Set<number>();
  
  for (let i = 0; i < items.length; i++) {
    if (used.has(i)) continue;
    let current = { ...(items[i] as Record<string, unknown>) };
    const name = (current.name as string) || '';
    
    for (let j = i + 1; j < items.length; j++) {
      if (used.has(j)) continue;
      const other = items[j] as Record<string, unknown>;
      const otherName = (other.name as string) || '';
      if (nameSimilarity(name, otherName) >= threshold) {
        current = mergeItems(current, other);
        used.add(j);
      }
    }
    result.push(current);
  }
  return result;
}

function mergeBatchResults(batchResults: Array<Record<string, unknown>>): Record<string, unknown> {
  const allThemes: unknown[] = []; const allPersonas: unknown[] = []; const allPillars: unknown[] = [];
  const clusterMap = new Map<string, Record<string, unknown>>();
  const formatMap = new Map<string, Record<string, unknown>>();

  for (const batch of batchResults) {
    for (const t of (batch.themes || []) as unknown[]) allThemes.push(t);
    for (const p of (batch.personas || []) as unknown[]) allPersonas.push(p);
    for (const p of (batch.creativePillars || []) as unknown[]) allPillars.push(p);
    for (const c of (batch.visualClusters || []) as Array<Record<string, unknown>>) {
      const name = (c.name as string) || '';
      const normName = normalizeName(name);
      let matched = false;
      for (const [key, ex] of clusterMap.entries()) {
        if (nameSimilarity(key, name) >= 0.5) {
          ex.count = ((ex.count as number) || 0) + ((c.count as number) || 0);
          const exIdx = (ex.adIndices as number[]) || [];
          const cIdx = (c.adIndices as number[]) || [];
          ex.adIndices = [...new Set([...exIdx, ...cIdx])];
          matched = true;
          break;
        }
      }
      if (!matched) clusterMap.set(name, { ...c });
    }
    for (const f of (batch.creativeFormats || []) as Array<Record<string, unknown>>) {
      const name = normalizeName((f.name as string) || '');
      if (formatMap.has(name)) {
        const ex = formatMap.get(name)!;
        ex.count = ((ex.count as number) || 0) + ((f.count as number) || 0);
        const existingIndices = (ex.adIndices as number[]) || [];
        const newIndices = (f.adIndices as number[]) || [];
        ex.adIndices = [...new Set([...existingIndices, ...newIndices])];
        const existingBrands = (ex.brands as string[]) || [];
        const newBrands = (f.brands as string[]) || [];
        ex.brands = [...new Set([...existingBrands, ...newBrands])];
        ex.maxDaysActive = Math.max((ex.maxDaysActive as number) || 0, (f.maxDaysActive as number) || 0);
        const totalCount = (ex.count as number);
        const prevCount = totalCount - ((f.count as number) || 0);
        const fCount = (f.count as number) || 0;
        if (prevCount + fCount > 0) {
          ex.avgDaysActive = Math.round(
            (((ex.avgDaysActive as number) || 0) * prevCount + ((f.avgDaysActive as number) || 0) * fCount) / (prevCount + fCount)
          );
        }
      } else {
        formatMap.set(name, { ...f });
      }
    }
  }

  // v15: Use fuzzy dedup instead of exact-match-only dedup
  return {
    themes: fuzzyDedup(allThemes),
    personas: fuzzyDedup(allPersonas),
    creativePillars: fuzzyDedup(allPillars),
    visualClusters: Array.from(clusterMap.values()),
    creativeFormats: Array.from(formatMap.values()),
  };
}

async function saveIntelligenceReport(jobId: string): Promise<{ success: boolean; analysisId?: string; error?: string }> {
  const job = await getJob(jobId);
  if (!job) return { success: false, error: 'Job not found' };

  const finalImages = await getJobImages(jobId);
  const allAnalyses = finalImages.filter(img => img.step1_analysis).map(img => img.step1_analysis);

  const merged = {
    themes: job.merged_themes || [],
    personas: job.merged_personas || [],
    creativePillars: job.merged_pillars || [],
    visualClusters: job.merged_clusters || [],
    creativeFormats: job.merged_formats || [],
  };

  const res = await fetch(ANALYSE_FN_URL, {
    method: "POST", headers: fnCallHeaders,
    body: JSON.stringify({
      step: 3,
      step1_result: { adAnalyses: allAnalyses, ...merged },
      chefly_prompts: [],
      ads: finalImages.map(img => ({
        imageUrl: img.image_url, title: img.headline, body: img.body_text,
        daysActive: img.days_active, displayFormat: img.display_format,
        pageName: img.page_name, isVideo: false,
      })),
      brands_analysed: job.brands_analysed || [],
      page_ids: job.page_ids || [],
      percentile: job.percentile || 10,
      type_filter: job.type_filter || 'all',
    }),
  });

  if (res.ok) {
    const saveData = await res.json();
    return { success: true, analysisId: saveData.analysis_id || null };
  }
  return { success: false, error: `Save returned ${res.status}` };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json();
    const { action, job_id, ads, brands_analysed, page_ids, percentile, type_filter } = body;

    console.log(`[process-analysis-batch v15] action=${action} job_id=${job_id || 'new'} service_key_len=${SUPABASE_SERVICE_KEY.length}`);

    // === CREATE: set up job + images ===
    if (action === 'create') {
      if (!ads || ads.length === 0) return jsonResp({ error: 'No ads provided' }, 400);
      const imageAds = ads.filter((a: Record<string, unknown>) => !a.isVideo && a.imageUrl && !(a.imageUrl as string).endsWith('.mp4') && !(a.imageUrl as string).endsWith('.mov'));
      if (imageAds.length === 0) return jsonResp({ error: 'No static image ads found' }, 400);

      const jobPayload = {
        brands_analysed: brands_analysed || [], page_ids: page_ids || [],
        percentile: Math.round(percentile || 10), type_filter: type_filter || 'all',
        total_images: imageAds.length, status: 'step1_running',
        step1_batch_size: STEP1_BATCH_SIZE, pipeline_version: 'v3.2',
      };

      const jobRes = await fetch(`${SUPABASE_URL}/rest/v1/analysis_jobs`, {
        method: "POST", headers: { ...sbHeaders, Prefer: "return=representation" },
        body: JSON.stringify(jobPayload),
      });

      if (!jobRes.ok) {
        const errText = await jobRes.text();
        return jsonResp({ error: `Failed to create job: ${jobRes.status} ${errText}` }, 500);
      }

      const jobRows = await jobRes.json();
      if (!jobRows || !Array.isArray(jobRows) || jobRows.length === 0) {
        return jsonResp({ error: 'Job insert returned empty response. Check RLS policies.' }, 500);
      }
      const job = jobRows[0];

      const imageRows = imageAds.map((ad: Record<string, unknown>, i: number) => ({
        job_id: job.id, ad_index: i, competitor_ad_id: ad.id || null,
        image_url: ad.imageUrl, page_name: ad.pageName || '',
        headline: ad.title || '', body_text: ad.body || '',
        days_active: ad.daysActive || 0, display_format: ad.displayFormat || 'IMAGE',
      }));
      for (let i = 0; i < imageRows.length; i += 50) {
        const chunk = imageRows.slice(i, i + 50);
        const insRes = await fetch(`${SUPABASE_URL}/rest/v1/analysis_job_images`, {
          method: "POST", headers: { ...sbHeaders, Prefer: "return=minimal" },
          body: JSON.stringify(chunk),
        });
        if (!insRes.ok) {
          const err = await insRes.text();
          return jsonResp({ error: `Failed to insert images: ${err}` }, 500);
        }
      }

      const urls = imageAds.map((ad: Record<string, unknown>) => ad.imageUrl as string);
      const priorCache = await findPriorAnalyses(urls, job.id);
      let reusedStep1 = 0;
      if (priorCache.size > 0) {
        const newImages = await getJobImages(job.id);
        for (const img of newImages) {
          const prior = priorCache.get(img.image_url as string);
          if (prior) {
            await updateImage(img.id as string, {
              step1_analysis: prior.step1_analysis,
              step1_status: 'completed',
              visual_cluster: prior.visual_cluster || null,
              creative_format: prior.creative_format || null,
            });
            reusedStep1++;
          }
        }
        if (reusedStep1 > 0) {
          // Rebuild merged fields from cached analyses so consolidation has data
          const cachedImages = await getJobImages(job.id, '&step1_status=eq.completed');
          const allCachedAnalyses = cachedImages.map(img => img.step1_analysis).filter(Boolean) as Record<string, unknown>[];
          const rebuiltThemes: unknown[] = [];
          const rebuiltPersonas: unknown[] = [];
          const rebuiltPillars: unknown[] = [];
          const rebuiltClusters: unknown[] = [];
          const rebuiltFormats: unknown[] = [];
          for (const a of allCachedAnalyses) {
            if (a.themes) rebuiltThemes.push(...(a.themes as unknown[]));
            if (a.personas) rebuiltPersonas.push(...(a.personas as unknown[]));
            if (a.creativePillars) rebuiltPillars.push(...(a.creativePillars as unknown[]));
            if (a.visualClusters) rebuiltClusters.push(...(a.visualClusters as unknown[]));
            if (a.creativeFormats) rebuiltFormats.push(...(a.creativeFormats as unknown[]));
          }
          await updateJob(job.id, {
            completed_step1: reusedStep1,
            merged_themes: rebuiltThemes,
            merged_personas: rebuiltPersonas,
            merged_pillars: rebuiltPillars,
            merged_clusters: rebuiltClusters,
            merged_formats: rebuiltFormats,
          });
          console.log(`[v16] Rebuilt merged fields from ${allCachedAnalyses.length} cached analyses: ${rebuiltThemes.length} themes, ${rebuiltPersonas.length} personas, ${rebuiltPillars.length} pillars, ${rebuiltClusters.length} clusters`);
        }
      }

      const newImages = imageAds.length - reusedStep1;
      return jsonResp({
        success: true, job_id: job.id, total_images: imageAds.length,
        reused_step1: reusedStep1, new_images: newImages,
        total_batches: Math.ceil(newImages / STEP1_BATCH_SIZE),
        batch_size: STEP1_BATCH_SIZE, status: 'step1_running',
        pipeline_version: 'v3.2',
      });
    }

    // === PROCESS_NEXT ===
    if (action === 'process_next') {
      if (!job_id) return jsonResp({ error: 'job_id required' }, 400);
      const job = await getJob(job_id);
      if (!job) return jsonResp({ error: 'Job not found' }, 404);
      const status = job.status as string;

      if (status === 'step1_running') {
        const result = await processNextStep1Batch(job_id);
        if (result.done) {
          const allImages = await getJobImages(job_id);
          const step1Succeeded = allImages.filter(i => i.step1_status === 'completed').length;
          const step1Failed = allImages.filter(i => i.step1_status === 'failed').length;
          if (step1Succeeded === 0) {
            const firstError = allImages.find(i => i.step1_error);
            await updateJob(job_id, { status: 'failed', error_message: `All ${step1Failed} images failed. ${(firstError?.step1_error as string) || ''}` });
            return jsonResp({ success: false, phase: 'failed', error: 'All images failed vision analysis' });
          }
          const merged = result.batchResult
            ? mergeBatchResults([{
                themes: result.batchResult.themes || [],
                personas: result.batchResult.personas || [],
                creativePillars: result.batchResult.creativePillars || [],
                visualClusters: result.batchResult.visualClusters || [],
                creativeFormats: result.batchResult.creativeFormats || [],
              }, {
                themes: (job.merged_themes || []) as unknown[],
                personas: (job.merged_personas || []) as unknown[],
                creativePillars: (job.merged_pillars || []) as unknown[],
                visualClusters: (job.merged_clusters || []) as unknown[],
                creativeFormats: (job.merged_formats || []) as unknown[],
              }])
            : {
                themes: job.merged_themes || [],
                personas: job.merged_personas || [],
                creativePillars: job.merged_pillars || [],
                visualClusters: job.merged_clusters || [],
                creativeFormats: job.merged_formats || [],
              };
          await updateJob(job_id, {
            status: 'consolidating',
            merged_clusters: merged.visualClusters, merged_themes: merged.themes,
            merged_personas: merged.personas, merged_pillars: merged.creativePillars,
            merged_formats: merged.creativeFormats,
          });
          return jsonResp({ success: true, phase: 'step1_done', next: 'consolidating', step1_succeeded: step1Succeeded, step1_failed: step1Failed });
        }
        if (result.batchResult) {
          const currentJob = await getJob(job_id);
          const existing = {
            themes: (currentJob?.merged_themes || []) as unknown[],
            personas: (currentJob?.merged_personas || []) as unknown[],
            creativePillars: (currentJob?.merged_pillars || []) as unknown[],
            visualClusters: (currentJob?.merged_clusters || []) as unknown[],
            creativeFormats: (currentJob?.merged_formats || []) as unknown[],
          };
          const merged = mergeBatchResults([existing as Record<string, unknown>, result.batchResult]);
          await updateJob(job_id, {
            merged_clusters: merged.visualClusters, merged_themes: merged.themes,
            merged_personas: merged.personas, merged_pillars: merged.creativePillars,
            merged_formats: merged.creativeFormats,
          });
        }
        return jsonResp({ success: true, phase: 'step1_running', batch_processed: true });
      }

      if (status === 'consolidating') {
        const consolResult = await runConsolidation(job_id);
        if (consolResult.success) {
          await updateJob(job_id, { status: 'saving' });
          return jsonResp({ success: true, phase: 'consolidation_done', next: 'saving' });
        } else {
          // v15: If consolidation fails, still move to saving but log the error
          await updateJob(job_id, { status: 'saving', error_message: `Consolidation failed (non-blocking): ${consolResult.error}` });
          return jsonResp({ success: true, phase: 'consolidation_failed_continuing', next: 'saving', error: consolResult.error });
        }
      }

      if (status === 'saving') {
        const saveResult = await saveIntelligenceReport(job_id);
        if (saveResult.success) {
          await updateJob(job_id, { status: 'completed', competitive_analysis_id: saveResult.analysisId || null });
        } else {
          await updateJob(job_id, { status: 'completed', error_message: `Legacy save failed but all results available in job: ${saveResult.error}` });
        }
        return jsonResp({ success: true, phase: 'completed' });
      }

      if (status === 'step2_running') {
        await updateJob(job_id, { status: 'completed', error_message: 'Step 2 skipped (v3 pipeline)' });
        return jsonResp({ success: true, phase: 'completed', message: 'Step 2 skipped -- pipeline v3' });
      }

      if (status === 'failed') {
        return jsonResp({ success: false, phase: 'failed', error: (await getJob(job_id))?.error_message || 'Job failed' });
      }
      return jsonResp({ success: true, phase: status, message: 'No work to do' });
    }

    // === RECONSOLIDATE: re-run consolidation on an existing completed/failed job ===
    if (action === 'reconsolidate') {
      if (!job_id) return jsonResp({ error: 'job_id required' }, 400);
      const job = await getJob(job_id);
      if (!job) return jsonResp({ error: 'Job not found' }, 404);
      
      // Re-run fuzzy dedup on existing merged data first
      const existing = {
        themes: (job.merged_themes || []) as unknown[],
        personas: (job.merged_personas || []) as unknown[],
        creativePillars: (job.merged_pillars || []) as unknown[],
        visualClusters: (job.merged_clusters || []) as unknown[],
        creativeFormats: (job.merged_formats || []) as unknown[],
      };
      const redebuped = {
        themes: fuzzyDedup(existing.themes),
        personas: fuzzyDedup(existing.personas),
        creativePillars: fuzzyDedup(existing.creativePillars),
        visualClusters: existing.visualClusters,
        creativeFormats: existing.creativeFormats,
      };
      
      await updateJob(job_id, {
        status: 'consolidating',
        merged_themes: redebuped.themes,
        merged_personas: redebuped.personas,
        merged_pillars: redebuped.creativePillars,
        merged_clusters: redebuped.visualClusters,
        merged_formats: redebuped.creativeFormats,
        error_message: null,
      });
      
      const consolResult = await runConsolidation(job_id);
      if (consolResult.success) {
        await updateJob(job_id, { status: 'completed' });
        const updatedJob = await getJob(job_id);
        return jsonResp({
          success: true, phase: 'reconsolidated',
          counts: {
            themes: ((updatedJob?.merged_themes || []) as unknown[]).length,
            personas: ((updatedJob?.merged_personas || []) as unknown[]).length,
            pillars: ((updatedJob?.merged_pillars || []) as unknown[]).length,
            clusters: ((updatedJob?.merged_clusters || []) as unknown[]).length,
            formats: ((updatedJob?.merged_formats || []) as unknown[]).length,
          },
          has_summary: !!(updatedJob?.consolidation_summary),
        });
      } else {
        await updateJob(job_id, { status: 'completed', error_message: `Reconsolidation failed: ${consolResult.error}` });
        return jsonResp({ success: false, phase: 'reconsolidate_failed', error: consolResult.error });
      }
    }

    if (action === 'status') {
      if (!job_id) return jsonResp({ error: 'job_id required' }, 400);
      const job = await getJob(job_id);
      if (!job) return jsonResp({ error: 'Job not found' }, 404);
      const imgs = await getJobImages(job_id);
      return jsonResp({
        job, images: imgs.map(i => ({
          id: i.id, ad_index: i.ad_index, step1_status: i.step1_status,
          visual_cluster: i.visual_cluster, creative_format: i.creative_format,
          image_url: i.image_url, page_name: i.page_name, headline: i.headline,
        })),
        summary: {
          total: imgs.length,
          step1_completed: imgs.filter(i => i.step1_status === 'completed').length,
          step1_failed: imgs.filter(i => i.step1_status === 'failed').length,
          step1_processing: imgs.filter(i => i.step1_status === 'processing').length,
        },
      });
    }

    if (action === 'results') {
      if (!job_id) return jsonResp({ error: 'job_id required' }, 400);
      const job = await getJob(job_id);
      if (!job) return jsonResp({ error: 'Job not found' }, 404);
      const images = await getJobImages(job_id);
      return jsonResp({
        job, images,
        analysis: {
          themes: job.merged_themes || [],
          personas: job.merged_personas || [],
          pillars: job.merged_pillars || [],
          clusters: job.merged_clusters || [],
          formats: job.merged_formats || [],
          consolidation_summary: job.consolidation_summary || null,
        },
      });
    }

    if (action === 'list_completed') {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/analysis_jobs?status=eq.completed&order=created_at.desc&select=id,brands_analysed,page_ids,total_images,completed_step1,pipeline_version,merged_themes,merged_personas,merged_pillars,merged_clusters,merged_formats,consolidation_summary,created_at`,
        { headers: sbHeaders }
      );
      if (!res.ok) return jsonResp({ error: 'Failed to list jobs' }, 500);
      const jobs = await res.json();
      return jsonResp({ success: true, jobs });
    }

    return jsonResp({ error: 'Unknown action. Use: create, process_next, reconsolidate, status, results, list_completed' }, 400);
  } catch (err) {
    console.error(`[process-analysis-batch v15] Unhandled error: ${String(err)}`);
    return jsonResp({ error: String(err) }, 500);
  }
});