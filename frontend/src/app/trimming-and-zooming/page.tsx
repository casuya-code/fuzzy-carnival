"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { type Language, finalizeVideo, processVideo, processVideoBatch, VideoProcessResult } from "@/lib/api";
import { fmtSize } from "@/lib/format";
import { addDeliverable, addVideoHistory, loadSpeechHistory, SpeechHistoryItem } from "@/lib/history";
import { createObjectUrlRegistry } from "@/lib/objectUrls";

interface ClipItem {
  id: string;
  file: File;
  url: string;
}

export default function TrimmingAndZoomingPage() {
  const [clips, setClips] = useState<ClipItem[]>([]);
  const [aspectRatio, setAspectRatio] = useState<"9:16" | "16:9" | "1:1">("9:16");
  const [trimEndSec, setTrimEndSec] = useState(0.5);
  const [audioMode, setAudioMode] = useState<"upload" | "history">("upload");
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [audioHistory, setAudioHistory] = useState<SpeechHistoryItem[]>([]);
  const [selectedAudioUrl, setSelectedAudioUrl] = useState<string>("");
  const [language, setLanguage] = useState<Language>("en");
  const [upscale2k, setUpscale2k] = useState(false);
  const [loudnorm, setLoudnorm] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<VideoProcessResult | null>(null);
  const [clipUrls] = useState(createObjectUrlRegistry);
  const clipInputRef = useRef<HTMLInputElement | null>(null);
  const audioInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const history = loadSpeechHistory();
    setAudioHistory(history);
    // Inherit the language of the most recent speech take when available.
    const firstWithLanguage = history.find((s) => s.language);
    if (firstWithLanguage?.language) setLanguage(firstWithLanguage.language);
  }, []);

  useEffect(() => {
    return () => clipUrls.revokeAll();
  }, [clipUrls]);

  const addClips = (files: FileList | null) => {
    if (!files) return;
    const next: ClipItem[] = Array.from(files).map((f) => ({
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      file: f,
      url: clipUrls.create(f),
    }));
    setClips((prev) => [...prev, ...next]);
  };

  const removeClip = (id: string) => {
    setClips((prev) => {
      const item = prev.find((c) => c.id === id);
      if (item) clipUrls.revoke(item.url);
      return prev.filter((c) => c.id !== id);
    });
  };

  const moveClip = (idx: number, dir: -1 | 1) => {
    setClips((prev) => {
      const next = [...prev];
      const j = idx + dir;
      if (j < 0 || j >= next.length) return prev;
      [next[idx], next[j]] = [next[j], next[idx]];
      return next;
    });
  };

  const clearClips = () => {
    clipUrls.revokeAll();
    setClips([]);
    if (clipInputRef.current) clipInputRef.current.value = "";
  };

  const process = async () => {
    setError(null);
    setResult(null);
    setProgress(null);
    if (clips.length === 0) { setError("Add at least one video clip."); return; }

    let audioPayload: { file?: File; key?: string } = {};
    if (audioMode === "upload") {
      if (!audioFile) { setError("Upload or select a unified audio track."); return; }
      audioPayload.file = audioFile;
    } else {
      const sel = audioHistory.find((a) => a.audio_url === selectedAudioUrl);
      if (!sel) { setError("Select an audio track from history."); return; }
      audioPayload.key = sel.audio_r2_key;
    }

    const topic = (typeof window !== "undefined" && localStorage.getItem("projectTopic")) || "Untitled";
    const files = clips.map((c) => c.file);

    setProcessing(true);
    try {
      let data: VideoProcessResult;

      // For larger jobs, split into smaller batch requests to avoid upload/timeouts and reduce failure risk.
      const BATCH_SIZE = 5;
      if (files.length > BATCH_SIZE) {
        const batchKeys: string[] = [];
        const totalBatches = Math.ceil(files.length / BATCH_SIZE);
        for (let b = 0; b < totalBatches; b++) {
          const start = b * BATCH_SIZE;
          const batchFiles = files.slice(start, start + BATCH_SIZE);
          setProgress(`Processing clips ${start + 1}-${Math.min(start + batchFiles.length, files.length)} of ${files.length} (batch ${b + 1}/${totalBatches})…`);
          const batch = await processVideoBatch({
            clips: batchFiles,
            aspect_ratio: aspectRatio,
            trim_end_sec: trimEndSec,
            topic,
            language,
            // Forward the selected audio so batch jobs get beat-synced zoom too.
            // No bpm is computed on this page — the backend derives it from the audio.
            audio: audioPayload.file,
            audio_r2_key: audioPayload.key,
          });
          if (!batch.video_r2_key) throw new Error("Batch processing did not return a video key.");
          batchKeys.push(batch.video_r2_key);
        }
        setProgress(`Finalizing video (${batchKeys.length} batches) with audio…`);
        data = await finalizeVideo({
          video_r2_keys: batchKeys,
          audio: audioPayload.file,
          audio_r2_key: audioPayload.key,
          aspect_ratio: aspectRatio,
          topic,
          language,
          upscale_2k: upscale2k,
          loudnorm,
        });
      } else {
        setProgress("Processing clips and attaching audio…");
        data = await processVideo({
          clips: files,
          audio: audioPayload.file,
          audio_r2_key: audioPayload.key,
          aspect_ratio: aspectRatio,
          trim_end_sec: trimEndSec,
          topic,
          language,
          upscale_2k: upscale2k,
          loudnorm,
        });
      }

      setResult(data);
      // Keep a reusable history entry; the handoff link below opens Add Captions
      // with this video URL selected.
      addVideoHistory({
        video_r2_key: data.video_r2_key,
        video_url: data.video_url,
        duration_seconds: data.duration_seconds,
        clips_processed: data.clips_processed ?? clips.length,
        aspect_ratio: aspectRatio,
        language,
        topic,
        engine_used: "trimmed & zoomed",
      });
      addDeliverable({
        kind: "trimmed",
        title: `Trimmed & zoomed (${data.clips_processed ?? clips.length} clips)`,
        url: data.video_url,
        r2_key: data.video_r2_key,
        meta: {
          duration_seconds: data.duration_seconds,
          aspect_ratio: aspectRatio,
          clips_processed: data.clips_processed ?? clips.length,
        },
      });
    } catch (e: any) {
      setError(e?.message || "Processing failed");
    } finally {
      setProcessing(false);
      setProgress(null);
    }
  };

  const selectedAudio = audioHistory.find((a) => a.audio_url === selectedAudioUrl);
  const selectHistoryAudio = (url: string) => {
    setSelectedAudioUrl(url);
    const s = audioHistory.find((a) => a.audio_url === url);
    if (s?.language) setLanguage(s.language);
  };

  return (
    <div className="space-y-6 pb-10">
      <header className="rounded-xl border bg-white p-4 sm:p-5 shadow-sm">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">✂️ Edit Video</h1>
          <p className="mt-2 text-sm sm:text-base text-gray-600 max-w-3xl">
            Put your clips together, trim the ends if needed, choose a video shape, and add your audio.
          </p>
        </div>
        <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
          {[
            { label: "Clips (n)", value: clips.length },
            { label: "Trim (t)", value: `${trimEndSec.toFixed(1)}s` },
            { label: "Aspect (r)", value: aspectRatio },
            { label: "Zoom", value: "auto/beat" },
          ].map((m) => (
            <div key={m.label} className="rounded-lg border bg-gradient-to-b from-gray-50 to-white px-2 py-2">
              <div className="text-[10px] uppercase tracking-wide text-gray-400">{m.label}</div>
              <div className="text-sm sm:text-base font-semibold font-mono text-gray-800 tabular-nums">{m.value}</div>
            </div>
          ))}
        </div>
      </header>

      <div className="grid gap-6 xl:grid-cols-2">
        {/* Clips */}
        <section className="rounded-xl border bg-white p-4 sm:p-5 shadow-sm space-y-4 min-w-0">
          <div className="flex items-center justify-between gap-2 border-b pb-2">
            <h2 className="text-base sm:text-lg font-semibold">① Video Clips (ordered)</h2>
            <span className="rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-mono text-blue-700">n = {clips.length}</span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={clipInputRef}
              type="file"
              accept="video/*,.mp4,.mov,.webm,.mkv"
              multiple
              className="hidden"
              onChange={(e) => { addClips(e.target.files); e.target.value = ""; }}
            />
            <button
              type="button"
              onClick={() => clipInputRef.current?.click()}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              ＋ Add clips
            </button>
            {clips.length > 0 && (
              <button type="button" onClick={clearClips} className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50">
                Clear all
              </button>
            )}
          </div>

          {clips.length === 0 ? (
            <div className="rounded-lg border border-dashed p-6 text-center text-sm text-gray-400">
              ∅ &nbsp; No clips yet. Add multiple video clips from your file manager (AI-generated or your own).
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50 text-[11px] uppercase tracking-wide text-gray-500">
                  <tr>
                    <th className="px-3 py-2 text-left font-semibold w-10">#</th>
                    <th className="px-3 py-2 text-left font-semibold">Clip</th>
                    <th className="px-3 py-2 text-left font-semibold hidden sm:table-cell">Meta</th>
                    <th className="px-3 py-2 text-right font-semibold">Order / Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {clips.map((c, i) => (
                    <tr key={c.id} className={i % 2 === 0 ? "bg-white" : "bg-gray-50/40"}>
                      <td className="px-3 py-2 font-mono text-gray-400 tabular-nums">{i + 1}</td>
                      <td className="px-3 py-2 max-w-[12rem]">
                        <div className="truncate font-medium text-gray-800" title={c.file.name}>{c.file.name}</div>
                        <div className="text-[11px] text-gray-400 sm:hidden font-mono">{fmtSize(c.file.size)}</div>
                      </td>
                      <td className="px-3 py-2 hidden sm:table-cell text-[11px] text-gray-500 font-mono whitespace-nowrap">
                        {c.file.type || "video"} · {fmtSize(c.file.size)}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex justify-end gap-1.5 flex-wrap">
                          <button onClick={() => moveClip(i, -1)} disabled={i === 0} className="rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-100 disabled:opacity-30">↑</button>
                          <button onClick={() => moveClip(i, 1)} disabled={i === clips.length - 1} className="rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-100 disabled:opacity-30">↓</button>
                          <button onClick={() => removeClip(c.id)} className="rounded-md border border-red-200 px-2 py-1 text-xs text-red-600 hover:bg-red-50">Remove</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-[11px] text-gray-400">Each clip: trim last <span className="font-mono">{trimEndSec}s</span> (tail warp) + dynamic zoom (1.0→1.12× static, 1.0→1.14× beat-synced), then stitch in order. When audio is attached, zoom follows the detected beat cycle; otherwise a fixed 2.5s cycle is used.</p>
        </section>

        {/* Audio + settings */}
        <section className="rounded-xl border bg-white p-4 sm:p-5 shadow-sm space-y-4 min-w-0">
          <div className="flex items-center justify-between gap-2 border-b pb-2">
            <h2 className="text-base sm:text-lg font-semibold">② Unified Audio &amp; Parameters</h2>
          </div>

          <div className="overflow-x-auto rounded-lg border">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 text-[11px] uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold">Parameter</th>
                  <th className="px-3 py-2 text-left font-semibold">Symbol</th>
                  <th className="px-3 py-2 text-left font-semibold min-w-[160px]">Control</th>
                  <th className="px-3 py-2 text-right font-semibold">Value</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                <tr className="bg-white">
                  <td className="px-3 py-3 font-medium text-gray-800">Aspect ratio</td>
                  <td className="px-3 py-3 font-mono text-gray-500">r</td>
                  <td className="px-3 py-3">
                    <div className="grid grid-cols-3 gap-2 max-w-sm">
                      <button type="button" onClick={() => setAspectRatio("9:16")} className={`rounded-md border px-2 py-1.5 text-xs font-medium ${aspectRatio === "9:16" ? "border-blue-500 bg-blue-600 text-white" : "border-gray-200 hover:bg-gray-50"}`}>9:16</button>
                      <button type="button" onClick={() => setAspectRatio("1:1")} className={`rounded-md border px-2 py-1.5 text-xs font-medium ${aspectRatio === "1:1" ? "border-blue-500 bg-blue-600 text-white" : "border-gray-200 hover:bg-gray-50"}`}>1:1</button>
                      <button type="button" onClick={() => setAspectRatio("16:9")} className={`rounded-md border px-2 py-1.5 text-xs font-medium ${aspectRatio === "16:9" ? "border-blue-500 bg-blue-600 text-white" : "border-gray-200 hover:bg-gray-50"}`}>16:9</button>
                    </div>
                  </td>
                  <td className="px-3 py-3 text-right font-mono tabular-nums">{aspectRatio}</td>
                </tr>
                <tr className="bg-gray-50/40">
                  <td className="px-3 py-3 font-medium text-gray-800">Trim tail</td>
                  <td className="px-3 py-3 font-mono text-gray-500">t</td>
                  <td className="px-3 py-3">
                    <input type="range" min={0} max={5} step={0.1} value={trimEndSec} onChange={(e) => setTrimEndSec(parseFloat(e.target.value))} className="w-full accent-purple-600" />
                  </td>
                  <td className="px-3 py-3 text-right font-mono tabular-nums">{trimEndSec.toFixed(1)} s</td>
                </tr>
                <tr className="bg-white">
                  <td className="px-3 py-3 font-medium text-gray-800">Language</td>
                  <td className="px-3 py-3 font-mono text-gray-500">ℓ</td>
                  <td className="px-3 py-3">
                    <select value={language} onChange={(e) => setLanguage(e.target.value as Language)} className="w-full max-w-[12rem] rounded-md border border-gray-300 px-2 py-1.5 text-sm">
                      <option value="en">English (en)</option>
                      <option value="sw">Swahili (sw)</option>
                    </select>
                  </td>
                  <td className="px-3 py-3 text-right font-mono tabular-nums">{language}</td>
                </tr>
                <tr className="bg-gray-50/40">
                  <td className="px-3 py-3 font-medium text-gray-800">Zoom cycle</td>
                  <td className="px-3 py-3 font-mono text-gray-500">z</td>
                  <td className="px-3 py-3 text-xs text-gray-500">Automatic: beat-synced to the attached audio when available (1.0→1.14×), otherwise a fixed 2.5s cycle (1.0→1.12×). Not adjustable here.</td>
                  <td className="px-3 py-3 text-right font-mono tabular-nums">Auto</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="rounded-lg border p-3 space-y-3">
            <div className="text-[11px] uppercase tracking-wide text-gray-400 font-semibold">Export quality options</div>
            <label className="flex items-start gap-2 text-sm text-gray-700 cursor-pointer select-none">
              <input type="checkbox" checked={loudnorm} onChange={(e) => setLoudnorm(e.target.checked)} className="mt-0.5" />
              <span>
                <span className="font-medium">Normalize loudness</span>
                <span className="block text-xs text-gray-500">Balance voice/music level for social playback (recommended).</span>
              </span>
            </label>
            <label className="flex items-start gap-2 text-sm text-gray-700 cursor-pointer select-none">
              <input type="checkbox" checked={upscale2k} onChange={(e) => setUpscale2k(e.target.checked)} className="mt-0.5" />
              <span>
                <span className="font-medium">YouTube 2K upscale</span>
                <span className="block text-xs text-gray-500">Export at higher resolution (e.g. 2560×1440 for 16:9) for sharper YouTube delivery. Slower to render.</span>
              </span>
            </label>
          </div>

          <div className="rounded-lg border p-3 space-y-3">
            <div className="text-[11px] uppercase tracking-wide text-gray-400 font-semibold">Unified audio (voiceover + music)</div>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setAudioMode("upload")} className={`rounded-md border px-3 py-2 text-xs sm:text-sm font-medium ${audioMode === "upload" ? "border-gray-800 bg-gray-800 text-white" : "border-gray-200 hover:bg-gray-50"}`}>📁 Upload audio</button>
              <button type="button" onClick={() => setAudioMode("history")} className={`rounded-md border px-3 py-2 text-xs sm:text-sm font-medium ${audioMode === "history" ? "border-gray-800 bg-gray-800 text-white" : "border-gray-200 hover:bg-gray-50"}`}>🕘 From history</button>
            </div>

            {audioMode === "upload" ? (
              <div className="space-y-2">
                <input ref={audioInputRef} type="file" accept="audio/*,.mp3,.wav,.m4a,.aac" className="hidden" onChange={(e) => setAudioFile(e.target.files?.[0] || null)} />
                <button type="button" onClick={() => audioInputRef.current?.click()} className="w-full rounded-lg border-2 border-dashed border-gray-300 p-3 text-sm text-gray-600 hover:border-blue-400 hover:bg-blue-50">
                  {audioFile ? `Selected: ${audioFile.name} (${fmtSize(audioFile.size)})` : "Choose unified audio file (MP3/WAV/AAC…)"}
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                <select value={selectedAudioUrl} onChange={(e) => selectHistoryAudio(e.target.value)} className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm">
                  <option value="">∅ Select from generated/mixed audio…</option>
                  {audioHistory.map((a) => (
                    <option key={a.audio_url} value={a.audio_url}>
                      {(a.engine_used || "audio")} — {a.audio_r2_key?.split("/").pop()?.slice(0, 14)}{a.duration_seconds ? ` (${a.duration_seconds.toFixed(1)}s)` : ""}
                    </option>
                  ))}
                </select>
                {selectedAudio && <audio controls src={selectedAudio.audio_url} className="w-full h-8" />}
                {audioHistory.length === 0 && <p className="text-[11px] text-gray-400">No history yet. Generate/mix audio first, or upload a file.</p>}
              </div>
            )}
            <p className="text-[11px] text-gray-400">Video loops if shorter than audio; output stops at audio end (<span className="font-mono">-shortest</span>).</p>
          </div>
        </section>
      </div>

      {/* Process & output */}
      <section className="rounded-xl border bg-white p-4 sm:p-5 shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-b pb-2">
          <h2 className="text-base sm:text-lg font-semibold">③ Process &amp; Export</h2>
          <span className="text-[11px] font-mono text-gray-400">
            ready = {clips.length > 0 ? "1" : "0"} · {((audioMode === "upload" && audioFile) || (audioMode === "history" && selectedAudioUrl)) ? "1" : "0"}
          </span>
        </div>

        {error && <p className="rounded-md bg-red-50 border border-red-100 p-2 text-sm text-red-700">{error}</p>}

        <button
          onClick={process}
          disabled={processing || clips.length === 0 || (audioMode === "upload" ? !audioFile : !selectedAudioUrl)}
          className="rounded-md bg-purple-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {processing ? "Processing… (trim → zoom → stitch → mux)" : "⚙️ Process & Export Video"}
        </button>

        {processing && (
          <p className="text-xs text-amber-600 font-mono">
            {progress || "Running FFmpeg pipeline on CPU… larger batches take longer."}
            {clips.length > 5 ? " Large jobs are processed in smaller batches automatically to reduce failures." : ""}
          </p>
        )}

        {result && (
          <div className="rounded-lg bg-green-50 border border-green-200 p-4 space-y-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <p className="text-sm font-semibold text-green-800">✅ Video rendered</p>
              <span className="text-xs font-mono text-green-700 bg-green-100 px-2 py-0.5 rounded">
                n={result.clips_processed ?? clips.length} · T={result.duration_seconds ? result.duration_seconds.toFixed(2) + "s" : "—"}
              </span>
            </div>
            <video controls src={result.video_url} className="w-full rounded-lg bg-black max-h-[480px]" />
            <div className="flex items-center gap-3 flex-wrap">
              <a href={result.video_url} download={`stitched-${result.video_r2_key?.split("/").pop() || "output.mp4"}`} className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-blue-700">⬇ Download MP4</a>
              <Link
                href={`/animated-captions?video_url=${encodeURIComponent(result.video_url)}`}
                className="rounded-md border border-purple-300 px-3 py-1.5 text-xs font-medium text-purple-700 transition hover:bg-purple-50"
              >
                ➕ Open in Add Captions
              </Link>
              <span className="text-[11px] text-gray-500 font-mono truncate max-w-full">{result.video_r2_key || "video output"}</span>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
