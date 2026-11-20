# Bilingual Voice Clone Platform

Clone voices in **English** and **Swahili** using four TTS engines, deployed on
**Vercel (free)** + **Railway ($5 Pro)** + **Cloudflare R2 (free)**.

## Engines

| Engine | Language | Cloning | RAM |
|---|---|---|---|
| Kyutai Pocket TTS | English | Zero-shot | ~1 GB |
| AfriSpeech (Pocket TTS) | English (African accent) | Zero-shot | ~1 GB |
| Msingi-AI Sauti (XTTS-v2) | Swahili | Zero-shot | ~3.5 GB |
| Meta MMS-TTS | Swahili | No (fallback) | ~0.5 GB |

## Architecture

- `frontend/` — Next.js 14 app deployed to Vercel. Records reference clips,
  uploads them directly to R2 via presigned URLs, calls Railway backend.
- `backend/` — FastAPI app deployed to Railway. Lazy-loads/swaps models to
  stay under the $5 container RAM limit, normalizes text & audio, stores
  outputs in R2.
- Cloudflare R2 — S3-compatible object storage for reference + generated audio/video.

## Tools (sidebar)

| Tool | Route | What it does |
|---|---|---|
| Text-to-Speech | `/text-to-speech` | Clean, noise-reduced voice cloning (EN/SW) with previews, variations & rendered exports. |
| Speech-and-Background | `/speech-and-background` | 3-layer mix: L1 voice, L2 ambient (steady), L3 music (sidechain-ducked) → loudnorm ~−16 LUFS. Voice-only mastering supported. |
| Trimming & Zooming | `/trimming-and-zooming` | Trim AI warp tails (`ffprobe`+`-t`), 2.5s `zoompan` punch-in, stitch clips, mux unified audio. |
| Animated Captions | `/animated-captions` | Karaoke-style word-by-word ASS captions burned with libass, locked into 9:16/1:1/16:9 safe zones. |
| Publish Package | `/publish-package` | Auto-designed YouTube thumbnail + 3 center-cropped 9:16 Shorts → 5 ready-to-post files in R2. |

### Animated Captions (how it works)

The website already knows the exact narration script and the 1.5s intro music
delay, so word timings need **no extra AI model and no extra RAM**:

```
tᵢ = t₀ + (Σⱼ<ᵢ wⱼ / Σw) · Tᵥ        wᵢ = chars(word) + punctuation pauses
ASS (DejaVu Sans Bold, Outline=5) → FFmpeg libass → MP4
```

- `backend/app/services/captions_processor.py` generates the `.ass` file with
  active-word highlighting (`{\c&H00FFFF&}` yellow, surrounding words white) in
  punchy 3-word chunks. Character-weighted timing gives short words (e.g. "na")
  proportionally less time than long ones (e.g. "Kilimanjaro").
- 9:16 safe zones use `MarginV=520`, `MarginL=90`, `MarginR=160` so captions
  clear the bottom platform UI and the right like/share button column.
- Video can come from the device file manager, from a previous Trimming &
  Zooming result (handed off via `videoHistory`), or be built fresh from clips.
- For fresh clips, captions are generated **before** the final merge and burned
  in the **same** FFmpeg pass as the audio mux — no double video encode.
- Dockerfile installs `fonts-dejavu-core` + `fonts-liberation` so libass renders
  crisp bold typography on the $5 Railway CPU container.

### Publish Package (thumbnail + 3 Shorts)

`backend/app/services/packaging_processor.py` replaces manual Canva/CapCut work
using only FFmpeg, Pillow and OpenCV (headless) — minimal RAM on the CPU container:

1. **Best frame:** sample frames with FFmpeg, keep the sharpest via OpenCV
   variance-of-Laplacian (Pillow edge-energy fallback), then boost contrast/saturation.
2. **Readability:** dark gradient overlay (left or bottom) + optional 8px accent border.
3. **3-word hook:** first two words white with heavy shadow, power word in a yellow/
   red/white rounded badge.
4. **3 Shorts:** center-crop `crop=ih*9/16:ih`, scale to 1080×1920, slice at
   `tᵢ = 0, 45, 90` (auto-fit to master length in the UI), overlay a top hook banner
   (`PART i: PHASE`) for the first 5s.

`POST /api/v1/packaging/publish` uploads the 5 deliverables:
`youtube_master_16x9.mp4`, `youtube_thumbnail.jpg`, and
`short_part_1..3_9x16.mp4`. `POST /api/v1/packaging/thumbnail` generates just the
thumbnail for a fast preview.

## Prerequisites

- Node.js 18+, Python 3.11 (backend targets 3.11; Coqui TTS for Msingi requires <3.12)
- ffmpeg installed locally (`ffmpeg -version`) with `libx264`, `aac`, `libmp3lame`
  and `libass`; a DejaVu/Liberation font for caption/thumbnail rendering (the
  Railway image installs these via apt)
- Pillow + opencv-python-headless (in `requirements.txt`) for thumbnail design
- A Cloudflare account (R2 bucket)
- A Hugging Face token with access to gated Kyutai weights
- Railway account ($5 Pro) and Vercel account (free hobby)

## 1. Cloudflare R2 setup

1. Create an R2 bucket named `voice-clone-audio`.
2. Create an R2 API token with Object Read/Write.
3. Note: Account ID, Access Key ID, Secret Access Key, and the public bucket URL
   (enable public access or use presigned URLs).

## 2. Backend (Railway)

### Local dev

```bash
cd backend
python -m venv .venv
# Windows: .venv\Scripts\activate
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env  # fill in values
uvicorn app.main:app --reload --port 8000
```

### Deploy to Railway

1. Install Railway CLI: `npm i -g @railway/cli`
2. `railway login`
3. `railway init` (create project)
4. `railway up` (deploys using Dockerfile)
5. Set environment variables in Railway dashboard (from `.env.example`),
   including `HF_TOKEN`, R2 credentials, `ALLOWED_ORIGINS` (your Vercel URL).
6. Railway will use `railway.toml` for healthcheck (`/health`) and restart
   policy. **Sleep mode** is enabled (`sleepApplication = true`) so the
   service sleeps when idle and wakes on the next request — saving the $5
   budget. The frontend header pings the backend `/health` endpoint to report
   wake-up status.

### Pre-fetch weights (optional, recommended for faster cold starts)

```bash
cd backend
python scripts/download_weights.py
```

Weights are gitignored; on Railway they download on first request unless
baked into the image (uncomment the RUN line in the Dockerfile).

## 3. Frontend (Vercel)

```bash
cd frontend
npm install
cp .env.local.example .env.local  # fill in R2 + Railway URL
npm run dev
```

Deploy:

```bash
cd frontend
npx vercel
```

Set env vars in Vercel dashboard: `R2_*` and `NEXT_PUBLIC_RAILWAY_API_URL`.

## 4. Usage

1. Open the Vercel app.
2. Record a 10–15s clean, single-speaker reference clip (denoise is on by default).
3. Pick language (🇬🇧 English / 🇹🇿 Swahili) and engine (`FLUENT (EN)` / `AFRICA (EN)`).
4. Type text, generate speech, then preview/save or render a speed+gain export.
5. In **Speech-and-Background**, stack the voice with ambient (L2) and/or music
   (L3), apply a preset, and export a mastered track (also saved to history).
6. In **Trimming & Zooming**, add ordered clips, set trim/aspect, pick the unified
   audio (upload or history), and export the stitched video.
7. In **Animated Captions**, pick that video (or upload your own), paste the exact
   script, preview timings, and burn karaoke captions; download the MP4 + `.ass`.
8. In **Publish Package**, pick the finished master, set the 3-word hook and accent,
   auto-fit the 3 Shorts, preview the thumbnail, then publish all 5 files.

## API endpoints (Railway)

- `POST /api/v1/synthesize`, `/normalize`, `/warm`
- `POST /api/v1/mix` (3-layer), `/audio/transform`, `/audio/analyze`
- `POST /api/v1/video/process` (optional `script_text` → captions in single pass)
- `POST /api/v1/captions/preview`, `POST /api/v1/captions/burn`
- `POST /api/v1/packaging/thumbnail`, `POST /api/v1/packaging/publish`

## Local dev without R2

When R2 credentials are absent, outputs are served from the backend's `/static`
mount (e.g. `http://127.0.0.1:8000/static/outputs/...`) and local uploads use
`PUT /api/v1/local-upload/{key}`. Ensure FFmpeg (incl. `C:\Users\Admin\ffmpeg` on
Windows) is on the backend process PATH.

## Memory management

`backend/app/services/model_manager.py` keeps Kyutai Pocket TTS warm by
default and unloads it (freeing RAM) only when a heavy Msingi-AI Sauti
request arrives, keeping the container under the Railway RAM limit.

## Text normalization

`backend/app/services/text_normalizer.py` converts digits to spoken words
(e.g. `10` → `ten` for English, `kumi` for Swahili) and expands common
abbreviations before synthesis.

## Sleep mode note

Railway sleeps the backend after inactivity. The first request after sleep
triggers a cold start (model reload). The frontend shows a "waking up"
indicator via the backend `/health` endpoint. Keep reference clips short to
reduce latency.

## License

MIT
