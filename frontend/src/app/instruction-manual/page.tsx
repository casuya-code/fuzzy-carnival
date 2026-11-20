/* eslint-disable react/no-unescaped-entities */
"use client";

import { useState } from "react";

const SECTIONS = [
  { id: "overview", title: "Overview" },
  { id: "getting-started", title: "Getting started" },
  { id: "tts", title: "Text-to-Speech" },
  { id: "speech-bg", title: "Speech-and-Background" },
  { id: "trimming", title: "Trimming & Zooming" },
  { id: "captions", title: "Animated Captions" },
  { id: "publish", title: "Publish Package" },
  { id: "history", title: "History" },
  { id: "api", title: "API endpoints" },
  { id: "troubleshooting", title: "Troubleshooting" },
  { id: "updates", title: "Update log" },
];

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-6 space-y-3">
      <h2 className="text-xl font-bold text-gray-900 border-b pb-1">{title}</h2>
      <div className="space-y-3 text-sm text-gray-700 leading-relaxed">{children}</div>
    </section>
  );
}

function Li({ children }: { children: React.ReactNode }) {
  return <li className="ml-5 list-disc">{children}</li>;
}

function Code({ children }: { children: React.ReactNode }) {
  return <code className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-[11px] text-gray-800 break-all">{children}</code>;
}

export default function InstructionManualPage() {
  const [active, setActive] = useState("overview");

  return (
    <div className="mx-auto max-w-4xl space-y-6 pb-10 px-2 sm:px-4">
      <div className="text-center">
        <h1 className="text-3xl font-bold">Yakodonyo Studio — Instruction Manual</h1>
        <p className="mt-2 text-sm text-gray-600">
          Complete step-by-step guide to every tool, option, and setting. Last updated: 2026-11-20.
        </p>
      </div>

      <nav className="flex flex-wrap gap-2 rounded-lg border bg-white p-3">
        {SECTIONS.map((s) => (
          <a
            key={s.id}
            href={`#${s.id}`}
            onClick={() => setActive(s.id)}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
              active === s.id ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200"
            }`}
          >
            {s.title}
          </a>
        ))}
      </nav>

      <div className="space-y-8">
        <Section id="overview" title="Overview">
          <p>
            Yakodonyo Studio is a bilingual (English / Swahili) AI voice-cloning and video post-production platform.
            It runs on <strong>Vercel (frontend)</strong> + <strong>Railway $5 (backend)</strong> + <strong>Cloudflare R2 (storage)</strong>.
          </p>
          <p>Core capabilities:</p>
          <ul>
            <Li>Clone a voice from a 10–15s reference clip (EN via Kyutai/AfriSpeech, SW via Msingi-AI Sauti/MMS).</Li>
            <Li>Generate speech with noise reduction, quality analysis, and rendered exports.</Li>
            <Li>Mix voice with ambient (L2) and music (L3, auto-ducked) into a mastered track.</Li>
            <Li>Trim AI warp tails, apply retention zoom, stitch clips, and attach unified audio.</Li>
            <Li>Burn karaoke-style word-by-word captions into 9:16/1:1/16:9 video.</Li>
            <Li>Auto-design a YouTube thumbnail and slice 3 vertical Shorts (5 files total).</Li>
            <Li>Persist all outputs in <strong>History</strong> so nothing disappears.</Li>
          </ul>
        </Section>

        <Section id="getting-started" title="Getting started">
          <p><strong>Local dev:</strong></p>
          <ul>
            <Li>Backend: <Code>cd backend && pip install -r requirements.txt && uvicorn app.main:app --reload --port 8000</Code></Li>
            <Li>Frontend: <Code>cd frontend && npm install && npm run dev</Code></Li>
            <Li>Ensure FFmpeg is on PATH (Windows: <Code>C:\Users\Admin\ffmpeg</Code>).</Li>
          </ul>
          <p><strong>Required env (backend .env):</strong> <Code>HF_TOKEN</Code>, R2 credentials, <Code>ALLOWED_ORIGINS</Code>.</p>
          <p><strong>Frontend .env.local:</strong> <Code>NEXT_PUBLIC_RAILWAY_API_URL=http://127.0.0.1:8000</Code></p>
        </Section>

        <Section id="tts" title="Text-to-Speech">
          <p><strong>Steps:</strong></p>
          <ol className="ml-5 list-decimal space-y-1">
            <li>Record or upload a 10–15s single-speaker reference clip (denoise on by default).</li>
            <li>Pick language: 🇬🇧 English or 🇹🇿 Swahili.</li>
            <li>Pick engine: <Code>FLUENT (EN)</Code> (Kyutai) or <Code>AFRICA (EN)</Code> (AfriSpeech) for English; Msingi-AI Sauti or MMS for Swahili.</li>
            <li>Type text and click Generate.</li>
            <li>Preview, copy URL, or render a speed+gain export.</li>
          </ol>
          <p><strong>How to get a good clone:</strong> record in a quiet room, 15 cm from the mic, speak naturally with varied intonation. Avoid background music. If the clip is under 3s the backend rejects it; 10–15s gives stable timbre.</p>
          <p><strong>Why denoise:</strong> removes hiss and rumble before cloning so the model learns the voice, not the room. Turn it off only if your clip is already clean studio audio.</p>
          <p><strong>Why two English engines:</strong> Kyutai is fast and general; AfriSpeech carries an African accent profile for content targeting East African audiences.</p>
          <p><strong>Options:</strong></p>
          <ul>
            <Li><strong>Voice ref</strong> — saved reference key used for cloning.</Li>
            <Li><strong>Denoise</strong> — background noise reduction (on/off).</Li>
            <Li><strong>Playback speed</strong> — 0.25× to 4.0×.</Li>
            <Li><strong>Volume</strong> — 0.0 to 4.0.</Li>
            <Li><strong>Quality analysis</strong> — RMS, peak, crest, SNR, clipping hints shown after upload.</Li>
          </ul>
        </Section>

        <Section id="speech-bg" title="Speech-and-Background">
          <p>3-layer mix: L1 voice, L2 ambient (steady), L3 music (sidechain-ducked).</p>
          <p><strong>How to build a mix:</strong> select a voice from history (or upload), add an ambient track (rain/wind) as L2, add a music bed as L3, set volumes, then click Mix. The result is saved to speech history automatically.</p>
          <p><strong>Why L2 is steady:</strong> ambient texture (rain, wind, ocean) should not duck — it fills silence naturally. Why L3 ducks: music must drop 6–10 dB under speech via sidechaincompress so narration stays intelligible.</p>
          <p><strong>Why loudnorm -16 LUFS:</strong> matches YouTube/Spotify loudness targets so your video is not quieter or louder than others.</p>
          <p><strong>Parameters:</strong></p>
          <ul>
            <Li><strong>Ambient volume (L2)</strong> — 0.0 to 1.0 (default 0.08).</Li>
            <Li><strong>Music volume (L3)</strong> — 0.0 to 1.0 (default 0.18).</Li>
            <Li><strong>Intro delay</strong> — 0 to 10000 ms (default 1500).</Li>
            <Li><strong>Outro pad</strong> — 0.0 to 10.0 s (default 2.5).</Li>
          </ul>
          <p>Output is loudness-normalized to ~−16 LUFS and saved to history for reuse in Trimming &amp; Zooming.</p>
        </Section>

        <Section id="trimming" title="Trimming & Zooming">
          <p><strong>Steps:</strong></p>
          <ol className="ml-5 list-decimal space-y-1">
            <li>Add ordered video clips (drag to reorder).</li>
            <li>Set aspect ratio: 9:16, 1:1, or 16:9.</li>
            <li>Set trim tail: 0.0 to 5.0 s (default 0.5s removes AI warp).</li>
            <li>Pick unified audio: upload from device or select from speech history.</li>
            <li>Click Process — output is saved to History automatically.</li>
          </ol>
          <p><strong>What happens:</strong> each clip is trimmed via <Code>ffprobe + -t</Code>, gets a 2.5s zoompan punch-in (1.0→1.12×), clips are stitched with <Code>-c:v copy</Code>, and audio is muxed with <Code>-stream_loop -1 + -shortest</Code>.</p>
          <p><strong>How to order clips:</strong> add clips in story order; use the up/down arrows to reorder. The stitch preserves this exact order.</p>
          <p><strong>Why trim 0.5s:</strong> AI-generated clips often end with a warp/flicker in the last frames. Cutting 0.5s removes it without hurting pacing.</p>
          <p><strong>Why zoompan:</strong> a slow 1.0→1.12× punch-in every 2.5s keeps viewers engaged (retention). Using <Code>-c:v copy</Code> for stitching avoids a second full re-encode, saving CPU and time.</p>
        </Section>

        <Section id="captions" title="Animated Captions">
          <p><strong>Sources:</strong> From Trimming (videoHistory), From device, or Fresh (single-pass from clips).</p>
          <p><strong>Parameters:</strong></p>
          <ul>
            <Li><strong>Intro delay (t₀)</strong> — 0.0 to 10.0 s.</Li>
            <Li><strong>Outro pad (ε)</strong> — 0.0 to 10.0 s.</Li>
            <Li><strong>Voice duration (Tᵥ)</strong> — auto or manual (0.5 to 600s).</Li>
            <Li><strong>Aspect ratio</strong> — 9:16, 1:1, 16:9.</Li>
            <Li><strong>Words / chunk (k)</strong> — 1 to 8 (default 3).</Li>
            <Li><strong>Trim tail</strong> — 0.0 to 5.0 s (fresh mode only).</Li>
          </ul>
          <p><strong>Safe zones:</strong> 9:16 uses MarginV=520, MarginL=90, MarginR=160. Active word highlighted yellow, others white, 3-word chunks.</p>
          <p>Preview shows exact word timings before burning. Download MP4 + <Code>.ass</Code> file.</p>
          <p><strong>How to get accurate captions:</strong> paste the <em>exact</em> narration script (same words and punctuation). Set intro delay to match your music intro (default 1.5s). Use auto voice duration unless you need a manual override.</p>
          <p><strong>Why character-weighted timing:</strong> short words like "na" get proportionally less time than long words like "Kilimanjaro", so captions feel natural. Punctuation adds small pauses.</p>
          <p><strong>Why 3-word chunks:</strong> readable at a glance on mobile. Active word turns yellow so viewers can follow along muted.</p>
        </Section>

        <Section id="publish" title="Publish Package">
          <p><strong>Steps:</strong></p>
          <ol className="ml-5 list-decimal space-y-1">
            <li>Select a master video (from history or device).</li>
            <li>Enter a 3-word hook and pick accent (yellow/red/white) + gradient (left/bottom) + border.</li>
            <li>Preview thumbnail (fast, no Shorts).</li>
            <li>Auto-fit Shorts to master length or beat-sync to music.</li>
            <li>Publish — generates thumbnail + 3 vertical Shorts (5 files total).</li>
          </ol>
          <p><strong>Parameters:</strong></p>
          <ul>
            <Li><strong>Clip length</strong> — 5 to 180 s (default 40).</Li>
            <Li><strong>Start times</strong> — comma-separated seconds for each Short.</Li>
            <Li><strong>Phases</strong> — labels for each Short banner (e.g. THE HOOK, THE CLIMAX, THE REVEAL).</Li>
          </ul>
          <p>Thumbnail: 1280×720, JPEG quality 90, max 3 bold words + accent badge. Shorts: 1080×1920 center-crop with top banner for first 5s.</p>
          <p><strong>How to write a good hook:</strong> use 3 punchy words (e.g. "AFRICA'S HIGHEST PEAK"). Put the most important/power word last — it gets the accent badge. Keep total under 30 characters for mobile legibility.</p>
          <p><strong>Why center-crop:</strong> 16:9 master → 9:16 without black bars, keeping the subject centered. Auto-fit sets 3 Shorts at 0, 1/3, 2/3 of the master length.</p>
          <p><strong>Why beat-sync:</strong> snapping start times and clip length to the music's BPM makes cuts land on drum hits, matching CapCut's beat-sync feel.</p>
        </Section>

        <Section id="history" title="History">
          <p>
            Every generated deliverable (trimmed videos, captioned videos, thumbnails, published packages) is saved to
            <Code>localStorage[&quot;deliverableHistory&quot;]</Code> and shown on the <strong>History</strong> page.
          </p>
          <ul>
            <Li>Per-item remove or clear all.</Li>
            <Li>Download links for every file.</Li>
            <Li>Persists across navigation and page reloads.</Li>
          </ul>
          <p><strong>How it works:</strong> every successful generate/publish call writes to <Code>localStorage["deliverableHistory"]</Code>. The History page reads it on load. No backend round-trip needed.</p>
          <p><strong>Why:</strong> prevents outputs from disappearing when you navigate away or refresh. Clearing the browser storage removes them.</p>
        </Section>

        <Section id="api" title="API endpoints">
          <ul>
            <Li><strong>How to call:</strong> all endpoints are under <Code>http://127.0.0.1:8000</Code> (local) or your Railway URL (prod). Use <Code>NEXT_PUBLIC_RAILWAY_API_URL</Code> to configure.</Li>
            <Li><Code>GET /health</Code> — wake-up status + loaded models.</Li>
            <Li><Code>POST /api/v1/synthesize</Code>, <Code>/normalize</Code>, <Code>/warm</Code></Li>
            <Li><Code>POST /api/v1/mix</Code> (3-layer), <Code>/audio/transform</Code>, <Code>/audio/analyze</Code>, <Code>/audio/bpm</Code></Li>
            <Li><Code>POST /api/v1/video/process</Code> (optional <Code>script_text</Code> for single-pass captions)</Li>
            <Li><Code>POST /api/v1/captions/preview</Code>, <Code>POST /api/v1/captions/burn</Code></Li>
            <Li><Code>POST /api/v1/packaging/thumbnail</Code>, <Code>POST /api/v1/packaging/publish</Code></Li>
            <Li><Code>PUT /api/v1/local-upload/{"{key:path}"}</Code> (dev fallback without R2)</Li>
          </ul>
        </Section>

        <Section id="troubleshooting" title="Troubleshooting">
          <ul>
            <Li><strong>Dev server 500s on Node 26:</strong> run <Code>npm run dev</Code> (uses <Code>--openssl-legacy-provider</Code> via cross-env).</Li>
            <Li><strong>FFmpeg not found:</strong> add <Code>C:\Users\Admin\ffmpeg</Code> to PATH.</Li>
            <Li><strong>Railway cold start:</strong> first request after sleep takes 10–30s; frontend shows &quot;waking up&quot;.</Li>
            <Li><strong>Msingi-AI Sauti unavailable:</strong> falls back to MMS-TTS (no cloning).</Li>
            <Li><strong>Stale .next cache:</strong> delete <Code>frontend/.next</Code> and restart.</Li>
          </ul>
        </Section>

        <Section id="updates" title="Update log">
          <ul>
            <Li><strong>2026-11-20:</strong> Added History sidebar + persistent deliverables. Added beat-sync BPM endpoint and UI. Added 20ms crossfades to final mix. Fixed FFmpeg HD flags (maxrate, bufsize, faststart). Added favicon. Cleaned debug UI. Created this manual.</Li>
            <Li><strong>2026-11-19:</strong> Full platform scaffold, 4 TTS engines, 3-layer mix, trimming/zoom, captions, publish package, R2 integration, Railway sleep config.</Li>
          </ul>
          <p className="text-xs text-gray-400 mt-4">
            This manual is updated with every feature change. If you add a new tool or option, update this page and the update log.
          </p>
        </Section>
      </div>
    </div>
  );
}
