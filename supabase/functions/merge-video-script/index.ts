import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SUPABASE_URL = "https://ifrxylvoufncdxyltgqt.supabase.co";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function supabaseHeaders() {
  return {
    apikey: SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
    "Content-Type": "application/json",
  };
}

interface TranscriptSegment {
  time: number;
  type: "voiceover";
  text: string;
}

interface OcrSegment {
  time: number;
  type: "on-screen";
  text: string;
  shot_number: number;
  description: string;
}

type ScriptSegment = TranscriptSegment | OcrSegment;

/**
 * Parse transcript_text into timed segments.
 * Supports: [0.0-2.5] text (from transcribe-video v2)
 * Supports: [0.0s] text (simple format)
 * Fallback: plain text as single segment at t=0
 */
function parseTranscript(transcriptText: string): TranscriptSegment[] {
  if (!transcriptText || !transcriptText.trim()) return [];

  const bracketPattern = /\[(\d+\.?\d*)[-\u2013](\d+\.?\d*)\]\s*(.+)/g;
  const segments: TranscriptSegment[] = [];
  let match;

  while ((match = bracketPattern.exec(transcriptText)) !== null) {
    segments.push({
      time: parseFloat(match[1]),
      type: "voiceover",
      text: match[3].trim(),
    });
  }

  if (segments.length > 0) return segments;

  const simplePattern = /\[(\d+\.?\d*)s?\]\s*(.+)/g;
  while ((match = simplePattern.exec(transcriptText)) !== null) {
    segments.push({
      time: parseFloat(match[1]),
      type: "voiceover",
      text: match[2].trim(),
    });
  }

  if (segments.length > 0) return segments;

  return [{
    time: 0,
    type: "voiceover",
    text: transcriptText.trim(),
  }];
}

function buildOcrSegments(shots: Array<Record<string, unknown>>): OcrSegment[] {
  return shots
    .filter((s) => s.ocr_text || s.description)
    .map((s) => ({
      time: parseFloat(String(s.start_time || 0)),
      type: "on-screen" as const,
      text: (s.ocr_text as string) || "",
      shot_number: s.shot_number as number,
      description: (s.description as string) || "",
    }));
}

function mergeTimeline(transcript: TranscriptSegment[], ocr: OcrSegment[]): ScriptSegment[] {
  const all: ScriptSegment[] = [...transcript, ...ocr];
  all.sort((a, b) => a.time - b.time);
  return all;
}

function formatCombinedScript(segments: ScriptSegment[]): string {
  const lines: string[] = [];

  for (const seg of segments) {
    const timestamp = `[${seg.time.toFixed(1)}s]`;

    if (seg.type === "voiceover") {
      lines.push(`${timestamp} VOICEOVER: ${seg.text}`);
    } else {
      const ocrSeg = seg as OcrSegment;
      const parts: string[] = [];
      if (ocrSeg.description) {
        parts.push(`VISUAL: ${ocrSeg.description}`);
      }
      if (ocrSeg.text) {
        parts.push(`TEXT ON SCREEN: ${ocrSeg.text}`);
      }
      lines.push(`${timestamp} [Shot ${ocrSeg.shot_number}] ${parts.join(" | ")}`);
    }
  }

  return lines.join("\n");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "POST required" }, 405);
  }

  try {
    const body = await req.json();
    const analysisId: string = body.analysis_id;

    if (!analysisId) {
      return jsonResponse({ error: "analysis_id is required" }, 400);
    }

    const analysisRes = await fetch(
      `${SUPABASE_URL}/rest/v1/video_analyses?id=eq.${analysisId}&select=*`,
      { headers: supabaseHeaders() }
    );
    if (!analysisRes.ok) throw new Error(`Failed to fetch analysis: ${analysisRes.status}`);
    const analyses = await analysisRes.json();

    if (!analyses || analyses.length === 0) {
      return jsonResponse({ error: "Analysis not found" }, 404);
    }

    const analysis = analyses[0];

    const shotsRes = await fetch(
      `${SUPABASE_URL}/rest/v1/video_shots?video_analysis_id=eq.${analysisId}&order=shot_number.asc&select=*`,
      { headers: supabaseHeaders() }
    );
    if (!shotsRes.ok) throw new Error(`Failed to fetch shots: ${shotsRes.status}`);
    const shots = await shotsRes.json();

    const transcriptSegments = parseTranscript(analysis.transcript_text || "");
    console.log(`Parsed ${transcriptSegments.length} transcript segments`);

    const ocrSegments = buildOcrSegments(shots);
    console.log(`Built ${ocrSegments.length} OCR segments from ${shots.length} shots`);

    const merged = mergeTimeline(transcriptSegments, ocrSegments);
    const combinedScript = formatCombinedScript(merged);
    console.log(`Combined script: ${combinedScript.length} chars, ${merged.length} segments`);

    const updateRes = await fetch(
      `${SUPABASE_URL}/rest/v1/video_analyses?id=eq.${analysisId}`,
      {
        method: "PATCH",
        headers: { ...supabaseHeaders(), Prefer: "return=representation" },
        body: JSON.stringify({ combined_script: combinedScript }),
      }
    );
    if (!updateRes.ok) {
      const errText = await updateRes.text();
      throw new Error(`Failed to update analysis: ${updateRes.status} ${errText}`);
    }

    return jsonResponse({
      success: true,
      analysis_id: analysisId,
      transcript_segments: transcriptSegments.length,
      ocr_segments: ocrSegments.length,
      total_segments: merged.length,
      combined_script: combinedScript,
      timeline: merged,
    });

  } catch (err) {
    console.error("merge-video-script error:", err);
    return jsonResponse({ error: String(err) }, 500);
  }
});
