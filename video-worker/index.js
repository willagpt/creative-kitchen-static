const express = require('express');
const cors = require('cors');
const { execSync, exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const WORKER_SECRET = process.env.WORKER_SECRET || 'dev-secret';
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ifrxylvoufncdxyltgqt.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const SCENE_THRESHOLD = parseFloat(process.env.SCENE_THRESHOLD || '0.3');
const TEMP_DIR = '/tmp/video-worker';

// Ensure temp directory exists
if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

// Auth middleware
function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || authHeader !== `Bearer ${WORKER_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// Download a file from URL to local path
function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const file = fs.createWriteStream(destPath);
    client.get(url, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        downloadFile(response.headers.location, destPath).then(resolve).catch(reject);
        return;
      }
      if (response.statusCode !== 200) {
        reject(new Error(`Download failed: HTTP ${response.statusCode}`));
        return;
      }
      response.pipe(file);
      file.on('finish', () => { file.close(); resolve(); });
      file.on('error', (err) => { fs.unlinkSync(destPath); reject(err); });
    }).on('error', (err) => { reject(err); });
  });
}

// Get video metadata via ffprobe
function getVideoMetadata(videoPath) {
  const result = execSync(
    `ffprobe -v quiet -show_entries format=duration,size -show_entries stream=width,height,codec_name,codec_type -of json "${videoPath}"`,
    { encoding: 'utf-8' }
  );
  return JSON.parse(result);
}

// Detect scene changes using FFmpeg
function detectScenes(videoPath, threshold) {
  const result = execSync(
    `ffmpeg -i "${videoPath}" -filter:v "select='gt(scene,${threshold})',showinfo" -f null - 2>&1`,
    { encoding: 'utf-8' }
  );

  const timestamps = [0]; // First frame is always shot 1
  const matches = result.matchAll(/pts_time:([0-9.]+)/g);
  for (const match of matches) {
    timestamps.push(parseFloat(match[1]));
  }
  return timestamps;
}

// Extract frames at given timestamps
function extractFrames(videoPath, timestamps, outputDir) {
  const frames = [];
  for (let i = 0; i < timestamps.length; i++) {
    const outputPath = path.join(outputDir, `shot_${String(i + 1).padStart(3, '0')}.jpg`);
    execSync(
      `ffmpeg -y -ss ${timestamps[i]} -i "${videoPath}" -frames:v 1 -q:v 2 "${outputPath}" 2>/dev/null`,
      { encoding: 'utf-8' }
    );
    frames.push({
      shot_number: i + 1,
      timestamp: timestamps[i],
      local_path: outputPath
    });
  }
  return frames;
}

// Extract audio as MP3
function extractAudio(videoPath, outputPath) {
  try {
    execSync(
      `ffmpeg -y -i "${videoPath}" -vn -acodec libmp3lame -q:a 4 "${outputPath}" 2>/dev/null`,
      { encoding: 'utf-8' }
    );
    return true;
  } catch (e) {
    return false;
  }
}

// Generate contact sheet from frames using row-by-row approach
function generateContactSheet(frames, outputPath, columns = 4) {
  if (frames.length === 0) return false;

  const thumbWidth = 360;
  const thumbHeight = 450;
  const totalFrames = frames.length;
  const rows = Math.ceil(totalFrames / columns);
  const tempDir = path.dirname(outputPath);

  try {
    // Step 1: Create uniform thumbnails for each frame
    const thumbPaths = [];
    for (let i = 0; i < totalFrames; i++) {
      const thumbPath = path.join(tempDir, `thumb_${String(i).padStart(3, '0')}.jpg`);
      execSync(
        `ffmpeg -y -i "${frames[i].local_path}" -vf "scale=${thumbWidth}:${thumbHeight}:force_original_aspect_ratio=decrease,pad=${thumbWidth}:${thumbHeight}:(ow-iw)/2:(oh-ih)/2:black" "${thumbPath}" 2>/dev/null`,
        { encoding: 'utf-8' }
      );
      thumbPaths.push(thumbPath);
    }

    // Step 2: Build rows by hstacking thumbnails
    const rowPaths = [];
    for (let r = 0; r < rows; r++) {
      const rowPath = path.join(tempDir, `row_${r}.jpg`);
      const start = r * columns;
      const end = Math.min(start + columns, totalFrames);
      const rowFrames = thumbPaths.slice(start, end);

      if (rowFrames.length === 1) {
        execSync(
          `ffmpeg -y -i "${rowFrames[0]}" -vf "pad=${thumbWidth * columns}:${thumbHeight}:0:0:black" "${rowPath}" 2>/dev/null`,
          { encoding: 'utf-8' }
        );
      } else if (rowFrames.length < columns) {
        const inputs = rowFrames.map(f => `-i "${f}"`).join(' ');
        const partialPath = path.join(tempDir, `row_${r}_partial.jpg`);
        execSync(
          `ffmpeg -y ${inputs} -filter_complex "hstack=inputs=${rowFrames.length}" "${partialPath}" 2>/dev/null`,
          { encoding: 'utf-8' }
        );
        execSync(
          `ffmpeg -y -i "${partialPath}" -vf "pad=${thumbWidth * columns}:${thumbHeight}:0:0:black" "${rowPath}" 2>/dev/null`,
          { encoding: 'utf-8' }
        );
        fs.unlinkSync(partialPath);
      } else {
        const inputs = rowFrames.map(f => `-i "${f}"`).join(' ');
        execSync(
          `ffmpeg -y ${inputs} -filter_complex "hstack=inputs=${columns}" "${rowPath}" 2>/dev/null`,
          { encoding: 'utf-8' }
        );
      }
      rowPaths.push(rowPath);
    }

    // Step 3: Vstack all rows
    if (rowPaths.length === 1) {
      fs.copyFileSync(rowPaths[0], outputPath);
    } else {
      const inputs = rowPaths.map(f => `-i "${f}"`).join(' ');
      execSync(
        `ffmpeg -y ${inputs} -filter_complex "vstack=inputs=${rowPaths.length}" "${outputPath}" 2>/dev/null`,
        { encoding: 'utf-8' }
      );
    }

    // Cleanup temp files
    thumbPaths.forEach(f => { try { fs.unlinkSync(f); } catch (e) {} });
    rowPaths.forEach(f => { try { fs.unlinkSync(f); } catch (e) {} });

    return true;
  } catch (e) {
    console.error('Contact sheet generation failed:', e.message);
    return false;
  }
}

// Upload file to Supabase Storage
async function uploadToStorage(supabase, bucket, storagePath, localPath, contentType) {
  const fileBuffer = fs.readFileSync(localPath);
  const { data, error } = await supabase.storage
    .from(bucket)
    .upload(storagePath, fileBuffer, {
      contentType,
      upsert: true
    });

  if (error) throw new Error(`Storage upload failed: ${error.message}`);

  const { data: urlData } = supabase.storage
    .from(bucket)
    .getPublicUrl(storagePath);

  return urlData.publicUrl;
}

// Cleanup temp files for an analysis
function cleanup(analysisId) {
  const dir = path.join(TEMP_DIR, analysisId);
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// Health check
app.get('/health', (req, res) => {
  try {
    const version = execSync('ffmpeg -version 2>&1 | head -1', { encoding: 'utf-8' }).trim();
    res.json({ status: 'ok', ffmpeg: version });
  } catch (e) {
    res.status(500).json({ status: 'error', message: 'FFmpeg not available' });
  }
});

// Main processing endpoint: analyse a video
app.post('/process-video', authenticate, async (req, res) => {
  const { video_url, analysis_id, scene_threshold } = req.body;

  if (!video_url || !analysis_id) {
    return res.status(400).json({ error: 'video_url and analysis_id are required' });
  }

  const threshold = scene_threshold || SCENE_THRESHOLD;
  const workDir = path.join(TEMP_DIR, analysis_id);
  const framesDir = path.join(workDir, 'frames');

  try {
    fs.mkdirSync(framesDir, { recursive: true });
    const videoPath = path.join(workDir, 'input.mp4');
    const audioPath = path.join(workDir, 'audio.mp3');
    const contactSheetPath = path.join(workDir, 'contact_sheet.jpg');

    console.log(`[${analysis_id}] Downloading video: ${video_url}`);
    await downloadFile(video_url, videoPath);
    const fileSize = fs.statSync(videoPath).size;
    console.log(`[${analysis_id}] Downloaded: ${(fileSize / 1024 / 1024).toFixed(1)}MB`);

    console.log(`[${analysis_id}] Getting metadata...`);
    const metadata = getVideoMetadata(videoPath);
    const duration = parseFloat(metadata.format.duration);
    const videoStream = metadata.streams.find(s => s.codec_type === 'video');
    const hasAudio = metadata.streams.some(s => s.codec_type === 'audio');

    console.log(`[${analysis_id}] Detecting scenes (threshold: ${threshold})...`);
    const sceneTimestamps = detectScenes(videoPath, threshold);
    console.log(`[${analysis_id}] Found ${sceneTimestamps.length} shots (${sceneTimestamps.length - 1} cuts)`);

    console.log(`[${analysis_id}] Extracting ${sceneTimestamps.length} frames...`);
    const frames = extractFrames(videoPath, sceneTimestamps, framesDir);

    let audioExtracted = false;
    if (hasAudio) {
      console.log(`[${analysis_id}] Extracting audio...`);
      audioExtracted = extractAudio(videoPath, audioPath);
    }

    console.log(`[${analysis_id}] Generating contact sheet...`);
    const contactSheetGenerated = generateContactSheet(frames, contactSheetPath);

    if (!SUPABASE_SERVICE_KEY) {
      console.log(`[${analysis_id}] No Supabase key - returning local results`);

      const shots = frames.map((frame, i) => {
        const nextTimestamp = i + 1 < sceneTimestamps.length ? sceneTimestamps[i + 1] : duration;
        return {
          shot_number: frame.shot_number,
          start_time: parseFloat(sceneTimestamps[i].toFixed(3)),
          end_time: parseFloat(nextTimestamp.toFixed(3)),
          duration: parseFloat((nextTimestamp - sceneTimestamps[i]).toFixed(3)),
          frame_url: null
        };
      });

      return res.json({
        analysis_id,
        duration: parseFloat(duration.toFixed(3)),
        width: videoStream?.width,
        height: videoStream?.height,
        total_shots: sceneTimestamps.length,
        total_cuts: sceneTimestamps.length - 1,
        has_audio: hasAudio && audioExtracted,
        shots,
        contact_sheet_url: null,
        audio_url: null
      });
    }

    console.log(`[${analysis_id}] Uploading to Supabase Storage...`);
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const storageBucket = 'video-processing';
    const storagePrefix = `analyses/${analysis_id}`;

    const shots = [];
    for (const frame of frames) {
      const storagePath = `${storagePrefix}/frames/shot_${String(frame.shot_number).padStart(3, '0')}.jpg`;
      const frameUrl = await uploadToStorage(supabase, storageBucket, storagePath, frame.local_path, 'image/jpeg');

      const nextIdx = frame.shot_number;
      const nextTimestamp = nextIdx < sceneTimestamps.length ? sceneTimestamps[nextIdx] : duration;

      shots.push({
        shot_number: frame.shot_number,
        start_time: parseFloat(sceneTimestamps[frame.shot_number - 1].toFixed(3)),
        end_time: parseFloat(nextTimestamp.toFixed(3)),
        duration: parseFloat((nextTimestamp - sceneTimestamps[frame.shot_number - 1]).toFixed(3)),
        frame_url: frameUrl
      });
    }

    let contactSheetUrl = null;
    if (contactSheetGenerated) {
      contactSheetUrl = await uploadToStorage(
        supabase, storageBucket,
        `${storagePrefix}/contact_sheet.jpg`,
        contactSheetPath, 'image/jpeg'
      );
    }

    let audioUrl = null;
    if (audioExtracted) {
      audioUrl = await uploadToStorage(
        supabase, storageBucket,
        `${storagePrefix}/audio.mp3`,
        audioPath, 'audio/mpeg'
      );
    }

    console.log(`[${analysis_id}] Processing complete`);
    cleanup(analysis_id);

    res.json({
      analysis_id,
      duration: parseFloat(duration.toFixed(3)),
      width: videoStream?.width,
      height: videoStream?.height,
      total_shots: sceneTimestamps.length,
      total_cuts: sceneTimestamps.length - 1,
      has_audio: hasAudio && audioExtracted,
      shots,
      contact_sheet_url: contactSheetUrl,
      audio_url: audioUrl
    });

  } catch (error) {
    console.error(`[${analysis_id}] Error:`, error.message);
    cleanup(analysis_id);
    res.status(500).json({ error: error.message, analysis_id });
  }
});

app.listen(PORT, () => {
  console.log(`Video worker listening on port ${PORT}`);
  try {
    const version = execSync('ffmpeg -version 2>&1 | head -1', { encoding: 'utf-8' }).trim();
    console.log(`FFmpeg: ${version}`);
  } catch (e) {
    console.error('WARNING: FFmpeg not found!');
  }
});
