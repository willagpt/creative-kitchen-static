# Creative Kitchen Video Worker

FFmpeg-based video processing microservice for the Video Analysis Engine.

## Endpoints

- `GET /health` — Health check (verifies FFmpeg available)
- `POST /process-video` — Process a video: download, detect shots, extract frames, generate contact sheet, extract audio

## Environment Variables

- `PORT` — Server port (default: 3000)
- `WORKER_SECRET` — Bearer token for authentication
- `SUPABASE_URL` — Supabase project URL
- `SUPABASE_SERVICE_KEY` — Supabase service role key (for Storage uploads)
- `SCENE_THRESHOLD` — FFmpeg scene detection threshold (default: 0.3)

## Deployment

Designed for Railway with Docker:

```bash
# Local dev
npm install
WORKER_SECRET=dev-secret node index.js

# Docker
docker build -t video-worker .
docker run -p 3000:3000 -e WORKER_SECRET=secret video-worker
```

## Test Videos

| ID | Brand | Duration | Shots | competitor_ads ID |
|----|-------|----------|-------|------------------|
| A | Simmer | 12.7s | 8 | 3324195914449903 |
| B | Huel | 21.4s | 17 | 33860239276954284 |
| C | Frive | 31.4s | 17 | 1440540640941645 |
