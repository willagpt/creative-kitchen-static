import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SUPABASE_URL = "https://ifrxylvoufncdxyltgqt.supabase.co";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") || "";
const STORAGE_BUCKET = "video-processing";

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

async function getAnalysis(analysisId: string) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/video_analyses?id=eq.${encodeURIComponent(analysisId)}&select=*&limit=1`,
    { headers: supabaseHeaders() }
  );
  if (!res.ok) throw new Error(`Failed to fetch analysis: ${res.status}`);
  const rows = await res.json();
  if (!rows || rows.length === 0) throw new Error(`Analysis not found: ${analysisId}`);
  return rows[0];
}

async function updateAnalysis(id: string, data: Record<string, unknown>) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/video_analyses?id=eq.${id}`,
    {
      method: "PATCH",
      headers: { ...supabaseHeaders(), Prefer: "return=representation" },
      body: JSON.stringify(data),
    }
  );
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Failed to update analysis: ${res.status} ${errText}`);
  }
  return (await res.json())[0];
}

async function downloadAudio(analysisId: string): Promise<Uint8Array> {
  const audioUrl = `${SUPABASE_URL}/storage/v1/object/public/${STORAGE_BUCKET}/analyses/${analysisId}/audio.mp3`;
  console.log(`Downloading audio: ${audioUrl}`);
  const res = await fetch(audioUrl);
  if (!res.ok) throw new Error(`Failed to download audio: ${res.status}`);
  const buffer = await res.arrayBuffer();
  return new Uint8Array(buffer);
}

async function transcribeWithWhisper(audioData: Uint8Array): Promise<{
  text: string;
  segments: Array<{ start: number; end: number; text: string }>;
}> {
  const formData = new FormData();
  const blob = new Blob([audioData], { type: "audio/mpeg" });
  formData.append("file", blob, "audio.mp3");
  formData.append("model", "whisper-1");
  formData.append("response_format", "verbose_json");
  formData.append("timestamp_granularities[]", "segment");

  console.log(`Sending ${(audioData.length / 1024).toFixed(0)}KB to Whisper API...`);
  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: formData,
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Whisper API error: ${res.status} ${errText}`);
  }

  const result = await res.json();
  return {
    text: result.text || "",
    segments: (result.segments || []).map((seg: { start: number; end: number; text: string }) => ({
      start: parseFloat(seg.start.toFixed(3)),
      end: parseFloat(seg.end.toFixed(3)),
      text: seg.text.trim(),
    })),
  };
}

/**
 * Format segments into timestamped transcript text.
 * Format: [0.0-2.5] text here
 * This allows the merge-video-script function to parse individual segments.
 */
function formatTimestampedTranscript(segments: Array<{ start: number; end: number; text: string }>): string {
  if (segments.length === 0) return "";
  return segments
    .map((seg) => `[${seg.start.toFixed(1)}-${seg.end.toFixed(1)}] ${seg.text}`)
    .join("\n");
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

    if (!OPENAI_API_KEY) {
      return jsonResponse({ error: "OPENAI_API_KEY not configured" }, 500);
    }

    // 1. Fetch the analysis record
    console.log(`Fetching analysis: ${analysisId}`);
    const analysis = await getAnalysis(analysisId);

    if (analysis.status !== "complete") {
      return jsonResponse({ error: `Analysis status is '${analysis.status}', expected 'complete'` }, 400);
    }

    // 2. Download audio from Supabase Storage
    let audioData: Uint8Array;
    try {
      audioData = await downloadAudio(analysisId);
    } catch (e) {
      return jsonResponse({
        error: `No audio file found for analysis ${analysisId}. The video may not have an audio track.`,
        details: String(e),
      }, 404);
    }

    console.log(`Audio downloaded: ${(audioData.length / 1024).toFixed(0)}KB`);

    if (audioData.length < 1000) {
      return jsonResponse({ error: "Audio file too small — likely no audio track" }, 400);
    }

    // 3. Transcribe with Whisper
    const transcript = await transcribeWithWhisper(audioData);
    console.log(`Transcription complete: ${transcript.segments.length} segments, ${transcript.text.length} chars`);

    // 4. Format timestamped transcript for storage
    const timestampedText = formatTimestampedTranscript(transcript.segments);
    const textToStore = timestampedText || transcript.text;

    // 5. Update the analysis record with transcript
    await updateAnalysis(analysisId, {
      transcript_text: textToStore,
    });

    console.log(`Analysis ${analysisId} updated with transcript (${transcript.segments.length} segments)`);

    return jsonResponse({
      success: true,
      analysis_id: analysisId,
      transcript_text: textToStore,
      plain_text: transcript.text,
      segments: transcript.segments,
      segment_count: transcript.segments.length,
      char_count: transcript.text.length,
    });

  } catch (err) {
    console.error("transcribe-video error:", err);
    return jsonResponse({ error: String(err) }, 500);
  }
});
