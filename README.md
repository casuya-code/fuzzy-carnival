# Bilingual Voice Clone Platform

Clone voices in **English** and **Swahili** using six TTS engines, deployed on
**Vercel (free)** + **Railway ($5 Pro)** + **Cloudflare R2 (free)**.

## Engines

| Engine option | Best use case | Cost / quota (typical) | RAM on Railway | Cloning | Notes |
|---|---|---|---|---|---|
| **Azure AI Speech** (`azure`, sw-TZ Daudi/Rehema) | Default Swahili storytelling, documentaries, narration | F0: 500k chars/mo free (plan-dependent) | 0 MB (cloud REST) | No (preset neural voices) | Auto-falls back to MMS on HTTP 429 quota/rate limit; commercial rights per Azure terms |
| **Kyutai Pocket TTS** (`kyutai`) | Unlimited English custom voice cloning from short sample | Included in your container | ~1.0 GB (CPU) | Zero-shot | Local/open weights |
| **AfriSpeech Pocket** (`afrispeech`) | African-accented English cloning from short sample | Included in your container | ~1.0 GB (CPU) | Zero-shot | Uses a community PocketTTS checkpoint via `AFRISPEECH_CONFIG`, otherwise the base Kyutai model |
| **ElevenLabs** (`elevenlabs`) | Dramatic character voices & short hooks (EN/SW accents) | Free tier limited (plan-dependent); paid unlocks more | 0 MB (cloud REST) | Preset voice, or IVC when `ELEVENLABS_ENABLE_CLONING=true` and your plan allows it | Uses `eleven_flash_v2_5` by default to stretch quota |
| **Msingi-AI Sauti / XTTS-v2** (`msingi`) | Self-hosted Swahili voice cloning (when cloud unavailable/quota used) | Included in your container | ~3.5 GB (loaded on demand) | Zero-shot | Uses base XTTS-v2 unless `MSINGI_CHECKPOINT_PATH` points to a fine-tuned checkpoint. Base XTTS has no `sw` token, so Swahili uses a safe tokenizer fallback with a UI warning |
| **Meta MMS-TTS** (`mms`) | Offline/low-cost Swahili fallback | Included in your container | ~0.5 GB | No | Sentence/chunked delivery with punctuation-aware breaths + adjustable pace; checkpoint swappable via `MMS_MODEL_ID` |

**Routing & safety rules**
- Text is normalized before synthesis (Swahili uses `kiswahili-text-normalizer` when available, custom loanwords from `backend/app/data/swahili_loanwords.json` or `SWAHILI_LOANWORDS_PATH`, then number/punctuation normalization). Raw text should be used for captions.
- If `azure` returns HTTP 429, the backend automatically falls back to `mms` for that request and returns a UI warning.
- `msingi` auto-detects the loaded checkpoint's languages. Stock XTTS-v2 does not include Swahili (`sw`), so it uses a supported tokenizer token (normally `en`) while still cloning your sample, and returns a UI warning. Point `MSINGI_CHECKPOINT_PATH` at a Swahili-aware checkpoint to use the native `sw` token; `MSINGI_LANGUAGE=auto` is the default and can be overridden in `backend/.env`.
- `COQUI_TOS_AGREED=1` is set automatically for unattended/server use; make sure your Coqui/XTTS/CPML usage complies with the applicable license terms.
- Cloud engines run over HTTPS and do not load PyTorch/XTTS weights into RAM (zero local model RAM for Azure/ElevenLabs).

**Swahili delivery (pauses, breaths, pace)**
- Meta MMS-TTS is a single-pass VITS vocoder: it reads straight through a paragraph with no natural breaths. The backend compensates by splitting long text at sentence/clause boundaries, synthesizing each segment, then stitching silence that follows the punctuation:
  - `.` → 480 ms, `!` → 500 ms, `?` → 560 ms (a real breath)
  - `,` → 180 ms, `;` → 240 ms, `:` → 260 ms (a short catch)
  - long segments also break at commas so a 60-word sentence never becomes a sprint
- **`speaking_rate`** (request field + "Speaking pace" slider, 0.7–1.4) maps to VITS `speaking_rate`: `<1.0` slower/more deliberate, `>1.0` faster. Verified 17.7 s at 0.8 vs 12.2 s at 1.2 on the same text.
- Swahili text without a trailing `.` is force-terminated, and `;`/`:` are rewritten, so passages don't run on.
- **Swap the checkpoint** with `MMS_MODEL_ID` (any VITS/MMS repo with its own tokenizer). Benchmarked on a 4-sentence Swahili passage:

  | `MMS_MODEL_ID` | Voiced | Peak | License |
  |---|---|---|---|
  | `facebook/mms-tts-swh` (default) | 68% | 0.73 | CC-BY-NC |
  | `stano03/jambogpt-swahili-tts-v1` | 74% | 0.80 | Apache-2.0 |
  | `mussacharles60/swahili-tts-female-voice` | 77% | 0.82 | MIT |

  Weights are cached per model under `backend/weights/mms/<model>/`, so switching never mixes checkpoints.

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
   including `HF_TOKEN`, R2 credentials, `ALLOWED_ORIGINS` (your Vercel URL),
   and (optional but recommended for premium Swahili quality) cloud TTS keys:
   `AZURE_SPEECH_KEY`, `AZURE_SPEECH_REGION`, `AZURE_SWAHILI_VOICE`,
   `ELEVENLABS_API_KEY`, `ELEVENLABS_MODEL_ID`, `ELEVENLABS_DEFAULT_VOICE_ID`,
   `ELEVENLABS_ENABLE_CLONING`.
6. Railway will use `railway.toml` for healthcheck (`/health`) and restart
   policy. **Sleep mode** is enabled (`sleepApplication = true`) so the
   service sleeps when idle and wakes on the next request — saving the $5
   budget. The frontend header pings the backend `/health` endpoint to report
   wake-up status. Cloud engines (Azure/ElevenLabs) keep local RAM usage near-zero.

### Pre-fetch weights (optional, recommended for faster cold starts)

```bash
cd backend
python scripts/download_weights.py
```

Weights are gitignored. The Dockerfile already runs this prefetch at build
time; outside Docker, run it manually before deploying (or let models download
on first request).

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
2. Record a 10–15s clean, single-speaker reference clip (denoise is on by default) for local cloning engines that need it.
3. Pick language (🇬🇧 English / 🇹🇿 Swahili) and engine:
   - **Swahili:** Azure AI Speech (default/premium neural) · Msingi/XTTS (self-hosted clone) · MMS (fallback) · ElevenLabs (hooks/character)
   - **English:** Kyutai/Fluent (clone) · AfriSpeech (accent clone) · ElevenLabs (hooks/character)
4. Type text (normalized for TTS automatically; keep raw script for captions), generate speech, then preview/save or render a speed+gain export. If Azure quota is exceeded, the app falls back to MMS and shows a warning.
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
- `POST /api/v1/mix` (3-layer), `/audio/transform`, `/audio/analyze`, `/audio/bpm`
- `POST /api/v1/video/process` (optional `script_text` → captions in single pass)
- `POST /api/v1/video/process-batch` (batch clip processing), `POST /api/v1/video/finalize`
- `POST /api/v1/timeline` (forced alignment with estimated fallback)
- `POST /api/v1/captions/preview`, `POST /api/v1/captions/burn`
- `POST /api/v1/packaging/thumbnail`, `POST /api/v1/packaging/publish`

## Local dev without R2

When R2 credentials are absent, outputs are served from the backend's `/static`
mount at their full key path (e.g. `http://127.0.0.1:8000/static/audio/20261120/...`);
older flat `outputs/<basename>` artifacts remain readable. Local uploads use
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
