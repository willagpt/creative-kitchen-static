import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function isGoodImageUrl(src: string): boolean {
  if (!src || src.length < 10) return false;
  if (src.endsWith('.svg') || src.includes('icon') || src.includes('logo') ||
      src.includes('pixel') || src.includes('tracking') || src.includes('1x1') ||
      src.includes('sprite') || src.includes('favicon') || src.includes('facebook.com/tr')) return false;
  if (/\.(jpg|jpeg|png|webp)/i.test(src)) return true;
  return false;
}

function resolveUrl(src: string, baseUrl: string): string {
  if (src.startsWith('//')) return 'https:' + src;
  if (src.startsWith('/')) return baseUrl + src;
  if (src.startsWith('http')) return src;
  return baseUrl + '/' + src;
}

function extractImageFromHtml(html: string, baseUrl: string): { thumbnail_url: string | null; debug: Record<string, unknown> } {
  const candidates: { url: string; score: number; source: string }[] = [];

  // 1. og:image
  const ogMatch = html.match(/<meta\s+[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i)
    || html.match(/<meta\s+[^>]*content=["']([^"']+)["'][^>]*property=["']og:image["']/i);
  if (ogMatch && isGoodImageUrl(ogMatch[1])) {
    candidates.push({ url: resolveUrl(ogMatch[1], baseUrl), score: 100, source: 'og:image' });
  }

  // 2. twitter:image
  const twMatch = html.match(/<meta\s+[^>]*name=["']twitter:image["'][^>]*content=["']([^"']+)["']/i)
    || html.match(/<meta\s+[^>]*content=["']([^"']+)["'][^>]*name=["']twitter:image["']/i);
  if (twMatch && isGoodImageUrl(twMatch[1])) {
    candidates.push({ url: resolveUrl(twMatch[1], baseUrl), score: 90, source: 'twitter:image' });
  }

  // 3. Regular img src
  const imgSrcMatches = html.match(/<img[^>]+src=["']([^"']+)["'][^>]*>/gi) || [];
  for (const tag of imgSrcMatches) {
    const m = tag.match(/src=["']([^"']+)["']/);
    if (m && isGoodImageUrl(m[1])) {
      const url = resolveUrl(m[1], baseUrl);
      const score = /hero|meal|product|food|dish|plate|banner/i.test(url) ? 80 : 40;
      candidates.push({ url, score, source: 'img-src' });
    }
  }

  // 4. data-src (lazy loading)
  const dataSrcMatches = html.match(/data-src=["']([^"']+)["']/gi) || [];
  for (const match of dataSrcMatches) {
    const m = match.match(/data-src=["']([^"']+)["']/);
    if (m && isGoodImageUrl(m[1])) {
      const url = resolveUrl(m[1], baseUrl);
      const score = /hero|meal|product|food|dish|plate|banner/i.test(url) ? 85 : 50;
      candidates.push({ url, score, source: 'data-src' });
    }
  }

  // 5. srcset
  const srcsetMatches = html.match(/srcset=["']([^"']+)["']/gi) || [];
  for (const match of srcsetMatches) {
    const m = match.match(/srcset=["']([^"']+)["']/);
    if (m) {
      const firstUrl = m[1].split(',')[0].trim().split(' ')[0];
      if (isGoodImageUrl(firstUrl)) {
        const url = resolveUrl(firstUrl, baseUrl);
        const score = /hero|meal|product|food|dish|plate|banner/i.test(url) ? 82 : 45;
        candidates.push({ url, score, source: 'srcset' });
      }
    }
  }

  // 6. background-image in CSS
  const bgMatches = html.match(/background(?:-image)?\s*:\s*url\(["']?([^"')]+)["']?\)/gi) || [];
  for (const match of bgMatches) {
    const m = match.match(/url\(["']?([^"')]+)["']?\)/);
    if (m && isGoodImageUrl(m[1])) {
      const url = resolveUrl(m[1], baseUrl);
      const score = /hero|meal|product|food|dish|plate|banner/i.test(url) ? 75 : 35;
      candidates.push({ url, score, source: 'bg-image' });
    }
  }

  // 7. JSON-LD schema.org image
  const jsonLdMatches = html.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi) || [];
  for (const block of jsonLdMatches) {
    const content = block.match(/>([\s\S]*?)<\/script>/i);
    if (content) {
      const imgInJson = content[1].match(/"image"\s*:\s*["']([^"']+)["']/i);
      if (imgInJson && isGoodImageUrl(imgInJson[1])) {
        candidates.push({ url: resolveUrl(imgInJson[1], baseUrl), score: 70, source: 'json-ld' });
      }
    }
  }

  // 8. Broad sweep: any URL ending in jpg/png/webp in the HTML
  if (candidates.length === 0) {
    const broadMatches = html.match(/(?:https?:\/\/[^"'\s]+\.(?:jpg|jpeg|png|webp))/gi) || [];
    for (const url of broadMatches.slice(0, 5)) {
      if (!url.includes('facebook.com/tr') && !url.includes('pixel') && !url.includes('icon')) {
        const score = /hero|meal|product|food|dish|plate|banner/i.test(url) ? 65 : 25;
        candidates.push({ url, score, source: 'broad-sweep' });
      }
    }
  }

  // Sort by score and return best
  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0] || null;

  return {
    thumbnail_url: best ? best.url : null,
    debug: {
      candidateCount: candidates.length,
      topCandidates: candidates.slice(0, 3).map(c => ({ url: c.url.substring(0, 100), score: c.score, source: c.source })),
      htmlLength: html.length,
    }
  };
}

function extractSnapshotImage(html: string): string | null {
  const ogMatch = html.match(/<meta\s+[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i)
    || html.match(/<meta\s+[^>]*content=["']([^"']+)["'][^>]*property=["']og:image["']/i);
  if (ogMatch) return ogMatch[1];
  const twMatch = html.match(/<meta\s+[^>]*name=["']twitter:image["'][^>]*content=["']([^"']+)["']/i)
    || html.match(/<meta\s+[^>]*content=["']([^"']+)["'][^>]*name=["']twitter:image["']/i);
  if (twMatch) return twMatch[1];
  const imgMatches = html.match(/<img[^>]+src=["']([^"']+)["'][^>]*>/gi);
  if (imgMatches) {
    for (const img of imgMatches) {
      const srcMatch = img.match(/src=["']([^"']+)["']/);
      if (srcMatch && (srcMatch[1].includes('fbcdn') || srcMatch[1].includes('scontent'))) return srcMatch[1];
    }
  }
  return null;
}

function detectVideo(html: string): boolean {
  return html.includes('<video') || html.includes('video_url') || html.includes('.mp4');
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body = await req.json();

    // MODE 1: Brand thumbnail
    if (body.mode === 'brand_thumbnail' && body.domain) {
      const domain = body.domain.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
      const url = `https://${domain}`;

      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);
        const res = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-GB,en;q=0.9',
          },
          signal: controller.signal,
          redirect: 'follow',
        });
        clearTimeout(timeout);

        const finalUrl = res.url;
        const htmlRaw = await res.text();
        const result = extractImageFromHtml(htmlRaw, new URL(finalUrl).origin);

        if (result.thumbnail_url && body.page_id) {
          const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
          const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
          const supabase = createClient(supabaseUrl, supabaseKey);
          await supabase.from('followed_brands').update({ thumbnail_url: result.thumbnail_url }).eq('page_id', body.page_id);
        }

        return new Response(JSON.stringify({
          thumbnail_url: result.thumbnail_url,
          debug: body.debug ? result.debug : undefined
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      } catch (err) {
        return new Response(JSON.stringify({ thumbnail_url: null, error: String(err) }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    // MODE 2: Per-ad snapshot extraction (existing)
    const { snapshot_urls } = body;
    if (!snapshot_urls || !Array.isArray(snapshot_urls)) {
      return new Response(JSON.stringify({ error: 'snapshot_urls array or mode=brand_thumbnail required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const results: Array<{ id: string; thumbnail_url: string | null; is_video: boolean }> = [];
    const batchSize = 5;
    for (let i = 0; i < snapshot_urls.length; i += batchSize) {
      const batch = snapshot_urls.slice(i, i + batchSize);
      const batchResults = await Promise.allSettled(
        batch.map(async (item: { id: string; url: string }) => {
          try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 8000);
            const res = await fetch(item.url, {
              headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36', 'Accept': 'text/html' },
              signal: controller.signal, redirect: 'follow',
            });
            clearTimeout(timeout);
            if (!res.ok) return { id: item.id, thumbnail_url: null, is_video: false };
            const html = await res.text();
            return { id: item.id, thumbnail_url: extractSnapshotImage(html), is_video: detectVideo(html) };
          } catch { return { id: item.id, thumbnail_url: null, is_video: false }; }
        })
      );
      for (const r of batchResults) { if (r.status === 'fulfilled') results.push(r.value); }
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);
    const updates = results.filter(r => r.thumbnail_url);
    for (const u of updates) { await supabase.from('competitor_ads').update({ thumbnail_url: u.thumbnail_url }).eq('id', u.id); }

    return new Response(JSON.stringify({ results, extracted: updates.length }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
