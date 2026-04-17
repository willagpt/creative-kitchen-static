import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SUPABASE_URL = "https://ifrxylvoufncdxyltgqt.supabase.co";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") || "";
const STORAGE_BUCKET = "video-processing";

// Retry policy for the Whisper call. Only transient failures (network,
// 5xx, 429) get retried. 4xx auth/validation failures bail immediately.
const MAX_WHISPER_ATTEMPTS = 3;
const WHISPER_BACKOFF_MS = [1000, 3000, 7000];

// If the last segment's end-time covers less than this share of the reported
// audio duration, flag the transcript as partial so the caller can surface it.
const PARTIAL_COVERAGE_THRESHOLD = 0.9;
const PARTIAL_MIN_DURATION_SECONDS = 5;

class WhisperError extends Error {
  status: number;
  transient: boolean;
  constructor(message: string, status: number, transient: boolean) {
    super(message);
    this.status = status;
    this.transient = transient;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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
  duration: number;
  segments: Array<{ start: number; end: number; text: string }>;
}> {
  const formData = new FormData();
  const blob = new Blob([audioData], { type: "audio/mpeg" });
  formData.append("file", blob, "audio.mp3");
  formData.append("model", "whisper-1");
  formData.append("response_format", "verbose_json");
  formData.append("timestamp_granularities[]", "segment");

  console.log(`Sending ${(audioData.length / 1024).toFixed(0)}KB to Whisper API...`);
  let res: Response;
  try {
    res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: formData,
    });
  } catch (netErr) {
    // fetch() only throws for transport-level failures (DNS, reset, TLS).
    // Treat these as transient so the retry loop kicks in.
    throw new WhisperError(`Whisper network error: ${String(netErr)}`, 0, true);
  }

  if (!res.ok) {
    const errText = await res.text();
    const transient = res.status === 429 || res.status >= 500;
    throw new WhisperError(
      `Whisper API error: ${res.status} ${errText}`,
      res.status,
      transient,
    );
  }

  const result = await res.json();
  return {
    text: result.text || "",
    duration: typeof result.duration === "number" ? result.duration : 0,
    segments: (result.segments || []).map((seg: { start: number; end: number; text: string }) => ({
      start: parseFloat(seg.start.toFixed(3)),
      end: parseFloat(seg.end.toFixed(3)),
      text: seg.text.trim(),
    })),
  };
}

/**
 * Decide if a Whisper response is partial. Whisper occasionally returns
 * truncated segments on low-quality audio, e.g. a 20s clip where only the
 * first 4s is transcribed. We don't retry in that case (retrying rarely
 * fixes it) but we flag it so callers can surface it in the UI.
 */
function assessPartial(result: {
  text: string;
  duration: number;
  segments: Array<{ start: number; end: number; text: string }>;
}): { isPartial: boolean; coverage: number; reason: string } {
  const duration = result.duration;
  const segments = result.segments;

  if (!segments || segments.length === 0) {
    // Zero segments but we got a 200 back. Treat as partial if we have any
    // audio duration at all; otherwise it's a genuinely silent clip.
    if (duration >= PARTIAL_MIN_DURATION_SECONDS) {
      return { isPartial: true, coverage: 0, reason: "no_segments_on_long_audio" };
    }
    return { isPartial: false, coverage: 1, reason: "short_or_silent_clip" };
  }

  if (!duration || duration < PARTIAL_MIN_DURATION_SECONDS) {
    return { isPartial: false, coverage: 1, reason: "short_clip" };
  }

  const lastEnd = segments[segments.length - 1].end || 0;
  const coverage = Math.min(1, lastEnd / duration);
  const isPartial = coverage < PARTIAL_COVERAGE_THRESHOLD;
  return {
    isPartial,
    coverage,
    reason: isPartial ? `coverage_${coverage.toFixed(2)}_below_${PARTIAL_COVERAGE_THRESHOLD}` : "ok",
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

  let analysisId: string | undefined;
  let attemptsSoFar = 0;
  let attemptsMade = 0;

  try {
    const body = await req.json();
    analysisId = body.analysis_id;

    if (!analysisId) {
      return jsonResponse({ error: "analysis_id is required" }, 400);
    }

    if (!OPENAI_API_KEY) {
      return jsonResponse({ error: "OPENAI_API_KEY not configured" }, 500);
    }

    // 1. Fetch the analysis record
    console.log(`Fetching analysis: ${analysisId}`);
    const analysis = await getAnalysis(analysisId);
    attemptsSoFar = typeof analysis.transcript_attempts === "number" ? analysis.transcript_attempts : 0;

    if (analysis.status !== "complete") {
      return jsonResponse({ error: `Analysis status is '${analysis.status}', expected 'complete'` }, 400);
    }

    // Mark transcribe as running so the UI can render a spinner instead of
    // a blank transcript column.
    await updateAnalysis(analysisId, { transcript_status: "running" });

    // 2. Download audio from Supabase Storage
    let audioData: Uint8Array;
    try {
      audioData = await downloadAudio(analysisId);
    } catch (e) {
      const errMsg = `No audio file found for analysis ${analysisId}. The video may not have an audio track.`;
      await updateAnalysis(analysisId, {
        transcript_status: "error",
        transcript_attempts: attemptsSoFar,
        transcript_error: `${errMsg} (${String(e).slice(0, 300)})`,
        transcript_completed_at: new Date().toISOString(),
      });
      return jsonResponse({ error: errMsg, details: String(e) }, 404);
    }

    console.log(`Audio downloaded: ${(audioData.length / 1024).toFixed(0)}KB`);

    if (audioData.length < 1000) {
      const errMsg = "Audio file too small, likely no audio track";
      await updateAnalysis(analysisId, {
        transcript_status: "error",
        transcript_attempts: attemptsSoFar,
        transcript_error: errMsg,
        transcript_completed_at: new Date().toISOString(),
      });
      return jsonResponse({ error: errMsg }, 400);
    }

    // 3. Transcribe with Whisper, with retry on transient failures.
    let transcript: { text: string; duration: number; segments: Array<{ start: number; end: number; text: string }> } | null = null;
    let lastError: unknown = null;

    for (let attempt = 1; attempt <= MAX_WHISPER_ATTEMPTS; attempt++) {
      attemptsMade = attempt;
      try {
        transcript = await transcribeWithWhisper(audioData);
        lastError = null;
        break;
      } catch (err) {
        lastError = err;
        const transient = err instanceof WhisperError ? err.transient : true;
        const status = err instanceof WhisperError ? err.status : 0;
        console.warn(
          `Whisper attempt ${attempt}/${MAX_WHISPER_ATTEMPTS} failed (status=${status}, transient=${transient}): ${String(err)}`,
        );
        if (!transient || attempt === MAX_WHISPER_ATTEMPTS) {
          break;
        }
        const backoff = WHISPER_BACKOFF_MS[Math.min(attempt - 1, WHISPER_BACKOFF_MS.length - 1)];
        await sleep(backoff);
      }
    }

    if (!transcript) {
      await updateAnalysis(analysisId, {
        transcript_status: "error",
        transcript_attempts: attemptsSoFar + attemptsMade,
        transcript_error: String(lastError).slice(0, 500),
        transcript_completed_at: new Date().toISOString(),
      });
      return jsonResponse({
        error: "Whisper transcription failed after retries",
        attempts: attemptsMade,
        details: String(lastError),
      }, 502);
    }

    console.log(
      `Transcription complete: ${transcript.segments.length} segments, ${transcript.text.length} chars, duration=${transcript.duration}s`,
    );

    // 4. Partial-text detection
    const partial = assessPartial(transcript);
    const finalStatus: "success" | "partial" = partial.isPartial ? "partial" : "success";
    console.log(`Partial assessment: ${finalStatus} (coverage=${partial.coverage.toFixed(2)}, reason=${partial.reason})`);

    // 5. Format timestamped transcript for storage
    const timestampedText = formatTimestampedTranscript(transcript.segments);
    const textToStore = timestampedText || transcript.text;

    // 6. Update the analysis record with transcript + observability fields
    await updateAnalysis(analysisId, {
      transcript_text: textToStore,
      transcript_status: finalStatus,
      transcript_attempts: attemptsSoFar + attemptsMade,
      transcript_error: partial.isPartial ? `partial: ${partial.reason}` : null,
      transcript_completed_at: new Date().toISOString(),
    });

    console.log(`Analysis ${analysisId} updated with transcript (${transcript.segments.length} segments, status=${finalStatus})`);

    return jsonResponse({
      success: true,
      analysis_id: analysisId,
      transcript_text: textToStore,
      plain_text: transcript.text,
      segments: transcript.segments,
      segment_count: transcript.segments.length,
      char_count: transcript.text.length,
      duration_seconds: transcript.duration,
      transcript_status: finalStatus,
      coverage: partial.coverage,
      attempts: attemptsMade,
    });

  } catch (err) {
    console.error("transcribe-video error:", err);
    // Best-effort observability write. If analysisId isn't set yet (request
    // parse failure), there's nothing to write.
    if (analysisId) {
      try {
        await updateAnalysis(analysisId, {
          transcript_status: "error",
          transcript_attempts: attemptsSoFar + attemptsMade,
          transcript_error: String(err).slice(0, 500),
          transcript_completed_at: new Date().toISOString(),
        });
      } catch (updateErr) {
        console.error("Failed to write error state to video_analyses:", updateErr);
      }
    }
    return jsonResponse({ error: String(err) }, 500);
  }
});
