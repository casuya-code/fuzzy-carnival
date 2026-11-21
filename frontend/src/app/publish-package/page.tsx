"use client";

import { useEffect, useState } from "react";
import { type Language, PackageResult, previewThumbnail, publishPackage, detectBpm } from "@/lib/api";
import { addDeliverable, loadSpeechHistory, loadVideoHistory, VideoHistoryItem } from "@/lib/history";
import { getMediaDuration } from "@/lib/media";

type SourceMode = "history" | "device";
type Accent = "yellow" | "red" | "white";
type Gradient = "left" | "bottom";

export default function PublishPackagePage() {
  const [sourceMode, setSourceMode] = useState<SourceMode>("history");
  const [topic, setTopic] = useState("Untitled");
  const [language, setLanguage] = useState<Language>("en");
  const [videoHistory, setVideoHistory] = useState<VideoHistoryItem[]>([]);
  const [selectedVideoUrl, setSelectedVideoUrl] = useState("");
  const [masterFile, setMasterFile] = useState<File | null>(null);
  const [deviceDuration, setDeviceDuration] = useState(0);
  const [devicePreviewUrl, setDevicePreviewUrl] = useState("");

  const [hookWords, setHookWords] = useState("AFRICA'S HIGHEST PEAK");
  const [accent, setAccent] = useState<Accent>("yellow");
  const [gradient, setGradient] = useState<Gradient>("left");
  const [border, setBorder] = useState(true);

  const [shortsTitle, setShortsTitle] = useState("MOUNT KILIMANJARO");
  const [clipLength, setClipLength] = useState(40);
  const [starts, setStarts] = useState<number[]>([0, 45, 90]);
  const [phases, setPhases] = useState<string[]>(["THE HOOK", "THE CLIMAX", "THE REVEAL"]);

  const [thumb, setThumb] = useState<{ url: string; key: string } | null>(null);
  const [thumbLoading, setThumbLoading] = useState(false);
  const [thumbError, setThumbError] = useState<string | null>(null);
  const [upscale2k, setUpscale2k] = useState(false);
  const [loudnorm, setLoudnorm] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PackageResult | null>(null);

  useEffect(() => {
    const list = loadVideoHistory();
    setVideoHistory(list);
    if (list.length) {
      setSelectedVideoUrl(list[0].video_url);
      if (list[0].language) setLanguage(list[0].language);
      if (list[0].topic) setTopic(list[0].topic);
      // Keep the initial auto-selection consistent with an explicit click.
      // Inlined so this mount-only effect has no callback dependency.
      const d = list[0].duration_seconds;
      if (d) {
        setClipLength(Math.max(5, Math.min(180, Math.floor(d / 3))));
        setStarts([0, Math.round(d / 3), Math.round(2 * d / 3)]);
      }
    }
    const speech = loadSpeechHistory().find((s) => s.language);
    if (speech?.language) setLanguage(speech.language);
    try {
      const t = localStorage.getItem("projectTopic");
      if (t) setTopic(t);
    } catch {}
  }, []);

  useEffect(() => {
    if (!masterFile) { setDevicePreviewUrl(""); return; }
    const u = URL.createObjectURL(masterFile);
    setDevicePreviewUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [masterFile]);

  const selectedVideo = videoHistory.find((v) => v.video_url === selectedVideoUrl);
  const knownDuration = sourceMode === "history" ? (selectedVideo?.duration_seconds || 0) : deviceDuration;
  const sourceReady = sourceMode === "history" ? !!selectedVideo?.video_r2_key : !!masterFile;

  const fitShorts = (duration: number) => {
    if (!duration || duration < 15) return;
    // Backend allows 5–180s (MAX_CLIP_LENGTH_SEC); match the slider's 180s cap.
    const len = Math.max(5, Math.min(180, Math.floor(duration / 3)));
    setClipLength(len);
    setStarts([0, Math.round(duration / 3), Math.round(2 * duration / 3)]);
  };

  const fitToBeats = async () => {
    if (sourceMode !== "history" || !selectedVideo?.video_r2_key || !selectedVideo.duration_seconds) return;
    try {
      const r = await detectBpm(selectedVideo.video_r2_key);
      const cycle = r.cycle_sec || 2;
      const snap = (x: number) => Math.max(0, Math.round(x / cycle) * cycle);
      const dur = selectedVideo.duration_seconds;
      setClipLength(Math.max(5, Math.min(180, snap(Math.floor(dur / 3)))));
      setStarts([0, snap(Math.round(dur / 3)), snap(Math.round((2 * dur) / 3))]);
    } catch (e: any) {
      setError(e?.message || "Beat detection failed");
    }
  };

  const chooseHistory = (url: string) => {
    setSelectedVideoUrl(url);
    const v = videoHistory.find((x) => x.video_url === url);
    if (v?.language) setLanguage(v.language);
    if (v?.topic) setTopic(v.topic);
    if (v?.duration_seconds) fitShorts(v.duration_seconds);
    setThumb(null); setResult(null);
  };

  const masterPayload = () =>
    sourceMode === "history"
      ? { master_r2_key: selectedVideo?.video_r2_key }
      : { master_video: masterFile };

  const doThumbPreview = async () => {
    setThumbError(null); setThumb(null);
    if (!sourceReady) { setThumbError("Select a master video first."); return; }
    setThumbLoading(true);
    try {
      const r = await previewThumbnail({ ...masterPayload(), hook_words: hookWords, accent, gradient, border, topic, language });
      setThumb({ url: r.thumbnail_url, key: r.thumbnail_r2_key });
      addDeliverable({ kind: "thumbnail", title: `Thumbnail: ${hookWords}`, url: r.thumbnail_url, r2_key: r.thumbnail_r2_key, meta: { width: r.width, height: r.height, hook_words: r.hook_words } });
    } catch (e: any) {
      setThumbError(e?.message || "Thumbnail preview failed");
    } finally {
      setThumbLoading(false);
    }
  };

  const publish = async () => {
    setError(null); setResult(null);
    if (!sourceReady) { setError("Select a master video (from history or device)."); return; }
    if (!hookWords.trim()) { setError("Enter a 3-word viral hook."); return; }
    if (hookWords.trim().split(/\s+/).length > 3) { setError("Use at most 3 words for the hook (only the first 3 are drawn)."); return; }
    setProcessing(true);
    try {
      const r = await publishPackage({
        ...masterPayload(),
        hook_words: hookWords.trim(),
        accent, gradient, border,
        shorts_title: shortsTitle,
        clip_length_sec: clipLength,
        start_times: starts,
        phases,
        topic, language,
        upscale_2k: upscale2k,
        loudnorm,
      });
      setResult(r);
      addDeliverable({ kind: "package", title: `Published package (${r.shorts.length} shorts)`, url: r.master_url, r2_key: r.master.r2_key, meta: { thumbnail_url: r.thumbnail_url, short_urls: r.short_urls, duration_seconds: r.duration_seconds } });
      r.shorts.forEach((s) => addDeliverable({ kind: "package", title: `Short part ${s.part}`, url: s.url, r2_key: s.r2_key, meta: { start_sec: s.start_sec, length_sec: s.length_sec } }));
    } catch (e: any) {
      setError(e?.message || "Publish failed");
    } finally {
      setProcessing(false);
    }
  };

  const hookArray = hookWords.trim().split(/\s+/).filter(Boolean).slice(0, 3);
  const fileCount = (result?.shorts.length ?? 3) + 2;
  const segColor = ["bg-blue-200", "bg-purple-200", "bg-amber-200"];

  return (
    <div className="space-y-6 pb-10">
      <header className="rounded-xl border bg-white p-4 sm:p-5 shadow-sm">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">📦 Ready to Post</h1>
          <p className="mt-2 text-sm sm:text-base text-gray-600 max-w-3xl">
            Create a thumbnail and short vertical clips from your finished video so it’s ready to share.
          </p>
        </div>
        <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
          {[
            { label: "Files out", value: fileCount },
            { label: "Thumbnail", value: "1280×720" },
            { label: "Shorts", value: "3 × 9:16" },
            { label: "Master T", value: knownDuration ? `${knownDuration.toFixed(0)}s` : "—" },
          ].map((m) => (
            <div key={m.label} className="rounded-lg border bg-gradient-to-b from-gray-50 to-white px-2 py-2">
              <div className="text-[10px] uppercase tracking-wide text-gray-400">{m.label}</div>
              <div className="text-sm sm:text-base font-semibold font-mono text-gray-800 tabular-nums">{m.value}</div>
            </div>
          ))}
        </div>
      </header>

      <div className="grid gap-6 xl:grid-cols-2">
        {/* Left: master + thumbnail design */}
        <div className="space-y-6 min-w-0">
          <section className="rounded-xl border bg-white p-4 sm:p-5 shadow-sm space-y-4">
            <div className="flex items-center justify-between gap-2 border-b pb-2">
              <h2 className="text-base sm:text-lg font-semibold">① Master film (16:9)</h2>
              <span className="text-[11px] font-mono text-gray-400">M ∈ {'{history, device}'}</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => { setSourceMode("history"); setThumb(null); setResult(null); }} className={`rounded-lg border px-3 py-2 text-sm font-medium ${sourceMode === "history" ? "border-blue-500 bg-blue-600 text-white" : "border-gray-200 hover:bg-gray-50"}`}>🕘 From previous step</button>
              <button type="button" onClick={() => { setSourceMode("device"); setThumb(null); setResult(null); }} className={`rounded-lg border px-3 py-2 text-sm font-medium ${sourceMode === "device" ? "border-blue-500 bg-blue-600 text-white" : "border-gray-200 hover:bg-gray-50"}`}>📁 From device</button>
            </div>
            {sourceMode === "history" ? (
              <div className="space-y-2">
                <select value={selectedVideoUrl} onChange={(e) => chooseHistory(e.target.value)} className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm">
                  <option value="">∅ Select a finished master video…</option>
                  {videoHistory.map((v) => (
                    <option key={v.video_url} value={v.video_url}>
                      {(v.engine_used || "video")} — {v.video_r2_key?.split("/").pop()?.slice(0, 14)}{v.duration_seconds ? ` (${v.duration_seconds.toFixed(0)}s)` : ""}
                    </option>
                  ))}
                </select>
                {videoHistory.length === 0 && <p className="text-[11px] text-gray-400">No finished videos yet — create one in Trimming &amp; Zooming or Animated Captions, or upload from device.</p>}
                {selectedVideo && <video controls src={selectedVideo.video_url} className="w-full rounded-lg bg-black max-h-56" />}
              </div>
            ) : (
              <div className="space-y-2">
                <input type="file" accept="video/*,.mp4,.mov,.webm,.mkv" className="w-full text-xs" onChange={async (e) => {
                  const f = e.target.files?.[0] || null;
                  setMasterFile(f); setThumb(null); setResult(null);
                  const d = f ? await getMediaDuration(f, "video") : 0;
                  setDeviceDuration(d);
                  fitShorts(d);
                }} />
                {masterFile && <p className="text-[11px] font-mono text-gray-500">{masterFile.name} · {deviceDuration.toFixed(1)}s</p>}
                {devicePreviewUrl && <video controls src={devicePreviewUrl} className="w-full rounded-lg bg-black max-h-56" />}
              </div>
            )}
          </section>

          <section className="rounded-xl border bg-white p-4 sm:p-5 shadow-sm space-y-4">
            <div className="flex items-center justify-between gap-2 border-b pb-2">
              <h2 className="text-base sm:text-lg font-semibold">② Thumbnail design (Pillow)</h2>
              <span className="text-[11px] font-mono text-gray-400">sharp frame ⊕ gradient ⊕ 3-word hook</span>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="space-y-2">
                <label className="text-[11px] uppercase tracking-wide text-gray-400 font-semibold">Project topic (for R2 file naming)</label>
                <input value={topic} onChange={(e) => { setTopic(e.target.value); try { localStorage.setItem("projectTopic", e.target.value); } catch {} }} className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm" placeholder="Kilimanjaro story" />
              </div>
              <div className="space-y-2">
                <label className="text-[11px] uppercase tracking-wide text-gray-400 font-semibold">Language</label>
                <select value={language} onChange={(e) => setLanguage(e.target.value as Language)} className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm">
                  <option value="en">English (en)</option>
                  <option value="sw">Swahili (sw)</option>
                </select>
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-[11px] uppercase tracking-wide text-gray-400 font-semibold">Viral hook (3 words)</label>
              <input value={hookWords} onChange={(e) => { setHookWords(e.target.value.trim().split(/\s+/).slice(0, 3).join(" ")); setThumb(null); }} className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm font-semibold uppercase" placeholder="AFRICA'S HIGHEST PEAK" />
              <div className="flex flex-wrap gap-1.5">
                <button type="button" onClick={() => setHookWords("AFRICA'S HIGHEST PEAK")} className="rounded border px-2 py-1 text-[11px] hover:bg-gray-50">🇹🇿 Highest peak</button>
                <button type="button" onClick={() => setHookWords("SIRI YA KILIMANJARO")} className="rounded border px-2 py-1 text-[11px] hover:bg-gray-50">🇹🇿 Siri ya Kilimanjaro</button>
                <button type="button" onClick={() => setHookWords("YOU WON'T BELIEVE")} className="rounded border px-2 py-1 text-[11px] hover:bg-gray-50">🇬🇧 Viral hook</button>
              </div>
              <p className="text-[11px] text-gray-400 font-mono">hook = [{hookArray.map((w) => w.toUpperCase()).join(", ")}] · last word gets the badge (max 3 words)</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <div className="text-[11px] uppercase tracking-wide text-gray-400 font-semibold">Accent colour</div>
                <div className="grid grid-cols-3 gap-1.5">
                  {(["yellow", "red", "white"] as Accent[]).map((a) => (
                    <button key={a} type="button" onClick={() => { setAccent(a); setThumb(null); }} className={`rounded-md border px-2 py-1.5 text-xs font-medium ${accent === a ? "border-gray-800 bg-gray-800 text-white" : "border-gray-200"}`}>{a}</button>
                  ))}
                </div>
              </div>
              <div className="space-y-1.5">
                <div className="text-[11px] uppercase tracking-wide text-gray-400 font-semibold">Readability gradient</div>
                <div className="grid grid-cols-2 gap-1.5">
                  {(["left", "bottom"] as Gradient[]).map((g) => (
                    <button key={g} type="button" onClick={() => { setGradient(g); setThumb(null); }} className={`rounded-md border px-2 py-1.5 text-xs font-medium ${gradient === g ? "border-gray-800 bg-gray-800 text-white" : "border-gray-200"}`}>{g}</button>
                  ))}
                </div>
              </div>
            </div>
            <label className="flex items-center gap-2 text-xs text-gray-600">
              <input type="checkbox" checked={border} onChange={(e) => { setBorder(e.target.checked); setThumb(null); }} /> Add high-contrast 8px accent border
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={doThumbPreview} disabled={thumbLoading || !sourceReady} className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">
                {thumbLoading ? "Designing…" : "🖼️ Preview thumbnail"}
              </button>
              <span className="text-[11px] text-gray-400 font-mono">1280×720 · contrast +25% · OpenCV sharpest frame</span>
            </div>
            {thumbError && <p className="rounded-md bg-red-50 border border-red-100 p-2 text-xs text-red-700">{thumbError}</p>}
            {thumb && (
              <div className="rounded-lg border bg-gray-50 p-3 space-y-2">
                {/* eslint-disable-next-line @next/next/no-img-element -- dynamic backend/R2 URL, not a static asset */}
                <img src={thumb.url} alt="Generated thumbnail preview" className="w-full rounded-lg border shadow-sm" />
                <p className="text-[11px] font-mono text-gray-500 truncate">{thumb.key}</p>
              </div>
            )}
          </section>
        </div>

        {/* Right: shorts config + manifest */}
        <div className="space-y-6 min-w-0">
          <section className="rounded-xl border bg-white p-4 sm:p-5 shadow-sm space-y-4">
            <div className="flex items-center justify-between gap-2 border-b pb-2">
              <h2 className="text-base sm:text-lg font-semibold">③ Vertical Shorts slicer</h2>
              <span className="text-[11px] font-mono text-gray-400">crop=ih*9/16:ih → 1080×1920</span>
            </div>
            <div className="space-y-2">
              <label className="text-[11px] uppercase tracking-wide text-gray-400 font-semibold">Series title (banner subtitle)</label>
              <input value={shortsTitle} onChange={(e) => setShortsTitle(e.target.value)} className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm" placeholder="MOUNT KILIMANJARO" />
            </div>
            <div className="rounded-lg border p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] uppercase tracking-wide text-gray-400 font-semibold">Clip length Δ</span>
                <span className="text-xs font-mono text-gray-600">{clipLength}s</span>
              </div>
              <input type="range" min={5} max={180} step={1} value={clipLength} onChange={(e) => setClipLength(parseInt(e.target.value))} className="w-full accent-purple-600" />
              <button type="button" onClick={() => fitShorts(knownDuration)} className="rounded border px-2 py-1 text-[11px] text-gray-600 hover:bg-gray-50">⤢ Auto-fit to master ({knownDuration.toFixed(0)}s)</button>
              {sourceMode === "history" && selectedVideo?.video_r2_key && (
                <button type="button" onClick={fitToBeats} className="rounded border px-2 py-1 text-[11px] text-gray-600 hover:bg-gray-50">🎵 Beat-sync starts</button>
              )}
              {sourceMode === "device" && (
                <p className="text-[11px] text-gray-400">Beat-sync needs an R2 key; device masters use local storage and cannot be beat-synced.</p>
              )}
            </div>
            <div className="overflow-x-auto rounded-lg border">
              <table className="min-w-full text-xs sm:text-sm">
                <thead className="bg-gray-50 text-[10px] uppercase tracking-wide text-gray-500">
                  <tr><th className="px-2 py-2 text-left">Part</th><th className="px-2 py-2 text-left">Phase</th><th className="px-2 py-2 text-right">Start tᵢ (s)</th></tr>
                </thead>
                <tbody className="divide-y">
                  {[0, 1, 2].map((i) => (
                    <tr key={i} className={i % 2 ? "bg-gray-50/40" : "bg-white"}>
                      <td className="px-2 py-2 font-mono font-semibold text-purple-600">S{i + 1}</td>
                      <td className="px-2 py-2"><input value={phases[i]} onChange={(e) => setPhases((p) => p.map((x, j) => j === i ? e.target.value : x))} className="w-full rounded border border-gray-200 px-2 py-1" /></td>
                      <td className="px-2 py-2 text-right"><input type="number" min={0} value={starts[i]} onChange={(e) => setStarts((s) => s.map((x, j) => j === i ? parseFloat(e.target.value) || 0 : x))} className="w-20 rounded border border-gray-200 px-2 py-1 text-right font-mono" /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="space-y-1.5">
              <div className="text-[11px] uppercase tracking-wide text-gray-400 font-semibold">Timeline (tᵢ → tᵢ+Δ)</div>
              <div className="relative h-14 overflow-hidden rounded-lg border bg-gray-50">
                {starts.map((s, i) => (
                  <div key={i} className={`absolute inset-y-1 rounded ${segColor[i]}`} style={{ left: knownDuration ? `${Math.min(95, (s / knownDuration) * 100)}%` : `${i * 33}%`, width: knownDuration ? `${Math.max(6, (clipLength / knownDuration) * 100)}%` : "30%" }}>
                    <span className="absolute inset-0 flex items-center justify-center text-[10px] font-mono font-semibold text-gray-700">S{i + 1}</span>
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-gray-400 font-mono">0s{' — '}{knownDuration.toFixed(0)}s · top hook banner for first 5s of each Short</p>
            </div>
          </section>

          <section className="rounded-xl border bg-white p-4 sm:p-5 shadow-sm space-y-3">
            <div className="flex items-center justify-between gap-2 border-b pb-2">
              <h2 className="text-base sm:text-lg font-semibold">④ Package manifest</h2>
              <span className="text-[11px] font-mono text-gray-400">{fileCount} files → R2</span>
            </div>

            <div className="rounded-lg border p-3 space-y-2">
              <div className="text-[11px] uppercase tracking-wide text-gray-400 font-semibold">Master export options</div>
              <label className="flex items-start gap-2 text-sm text-gray-700 cursor-pointer select-none">
                <input type="checkbox" checked={loudnorm} onChange={(e) => setLoudnorm(e.target.checked)} className="mt-0.5" />
                <span>
                  <span className="font-medium">Normalize loudness</span>
                  <span className="block text-xs text-gray-500">Balance audio for social playback before packaging (recommended).</span>
                </span>
              </label>
              <label className="flex items-start gap-2 text-sm text-gray-700 cursor-pointer select-none">
                <input type="checkbox" checked={upscale2k} onChange={(e) => setUpscale2k(e.target.checked)} className="mt-0.5" />
                <span>
                  <span className="font-medium">YouTube 2K master upscale</span>
                  <span className="block text-xs text-gray-500">Export the 16:9 master at 2560×1440 for sharper YouTube delivery. Slower to process.</span>
                </span>
              </label>
            </div>
            <div className="overflow-x-auto rounded-lg border">
              <table className="min-w-full text-xs sm:text-sm">
                <thead className="bg-gray-50 text-[10px] uppercase tracking-wide text-gray-500">
                  <tr><th className="px-2 py-2 text-left">#</th><th className="px-2 py-2 text-left">File</th><th className="px-2 py-2 text-left hidden sm:table-cell">Formula</th><th className="px-2 py-2 text-right">Spec</th></tr>
                </thead>
                <tbody className="divide-y">
                  <tr className="bg-white"><td className="px-2 py-2 font-mono text-gray-400">1</td><td className="px-2 py-2 font-medium">youtube_master_16x9.mp4</td><td className="px-2 py-2 font-mono text-gray-500 hidden sm:table-cell">M ⊕ voice ⊕ ducked music</td><td className="px-2 py-2 text-right font-mono">{upscale2k ? "2560×1440" : "1920×1080"}</td></tr>
                  <tr className="bg-gray-50/40"><td className="px-2 py-2 font-mono text-gray-400">2</td><td className="px-2 py-2 font-medium">youtube_thumbnail.jpg</td><td className="px-2 py-2 font-mono text-gray-500 hidden sm:table-cell">argmax_sharp(F) ⊕ grad ⊕ hook</td><td className="px-2 py-2 text-right font-mono">1280×720</td></tr>
                  {[0, 1, 2].map((i) => (
                    <tr key={i} className={i % 2 ? "bg-gray-50/40" : "bg-white"}>
                      <td className="px-2 py-2 font-mono text-gray-400">{i + 3}</td>
                      <td className="px-2 py-2 font-medium">short_part_{i + 1}_9x16.mp4</td>
                      <td className="px-2 py-2 font-mono text-gray-500 hidden sm:table-cell">crop(M,t={starts[i]}s,Δ={clipLength}s)</td>
                      <td className="px-2 py-2 text-right font-mono">1080×1920</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </div>

      {/* Publish */}
      <section className="rounded-xl border bg-white p-4 sm:p-5 shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-b pb-2">
          <h2 className="text-base sm:text-lg font-semibold">⑤ Publish Package</h2>
          <span className="text-[11px] font-mono text-gray-400">ready = src:{sourceReady ? "1" : "0"} · hook:{hookWords.trim() ? "1" : "0"} · shorts:3</span>
        </div>
        {error && <p className="rounded-md bg-red-50 border border-red-100 p-2 text-sm text-red-700">{error}</p>}
        <div className="flex flex-wrap items-center gap-3">
          <button onClick={publish} disabled={processing || !sourceReady || !hookWords.trim()} className="rounded-md bg-purple-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed">
            {processing ? `Packaging ${fileCount} files… (FFmpeg + Pillow)` : "🚀 Publish Package"}
          </button>
          <span className="text-[11px] text-gray-400 font-mono">thumbnail → 3 center-crop shorts → upload all to R2</span>
        </div>
        {processing && <p className="text-xs text-amber-600 font-mono">Rendering on Railway CPU (ultrafast) — long masters take proportionally longer.</p>}

        {result && (
          <div className="rounded-lg bg-green-50 border border-green-200 p-4 space-y-4">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <p className="text-sm font-semibold text-green-800">✅ {fileCount} files ready to post</p>
              <span className="text-xs font-mono text-green-700 bg-green-100 px-2 py-0.5 rounded">pkg={result.package_id.slice(0, 8)} · T={result.duration_seconds ? `${result.duration_seconds.toFixed(0)}s` : "—"}</span>
            </div>

            <div className="grid gap-4 lg:grid-cols-3">
              <div className="space-y-2">
                <div className="text-[11px] uppercase tracking-wide text-gray-500 font-semibold">YouTube thumbnail</div>
                {/* eslint-disable-next-line @next/next/no-img-element -- dynamic backend/R2 URL, not a static asset */}
                <img src={result.thumbnail_url} alt="Final YouTube thumbnail" className="w-full rounded-lg border shadow-sm" />
                <p className="text-[11px] font-mono text-gray-500">
                  {result.thumbnail.width}×{result.thumbnail.height} · hook: {result.thumbnail.hook_words.join(" / ")}
                </p>
                <a href={result.thumbnail_url} download="youtube_thumbnail.jpg" className="inline-block rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700">⬇ Thumbnail JPG</a>
              </div>
              <div className="space-y-2 lg:col-span-2">
                <div className="text-[11px] uppercase tracking-wide text-gray-500 font-semibold">Master film (16:9)</div>
                <video controls src={result.master_url} className="w-full rounded-lg bg-black max-h-64" />
                <p className="text-[11px] font-mono text-gray-500">{upscale2k ? "2560×1440" : "1920×1080"}</p>
                <a href={result.master_url} download="youtube_master_16x9.mp4" className="inline-block rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700">⬇ Master MP4</a>
              </div>
            </div>

            <div className="space-y-2">
              <div className="text-[11px] uppercase tracking-wide text-gray-500 font-semibold">3 vertical Reels / Shorts (9:16)</div>
              <div className="grid gap-4 sm:grid-cols-3">
                {result.shorts.map((s) => (
                  <div key={s.part} className="rounded-lg border bg-white p-2 space-y-2">
                    <div className="flex items-center justify-between text-[11px] font-mono text-gray-500">
                      <span>PART {s.part} · {phases[s.part - 1]}</span>
                      <span>t={s.start_sec}s +{s.length_sec}s · {s.aspect_ratio}</span>
                    </div>
                    <video controls src={s.url} className="w-full rounded-lg bg-black max-h-72" />
                    <a href={s.url} download={`short_part_${s.part}_9x16.mp4`} className="inline-block rounded-md border border-gray-300 px-2.5 py-1 text-[11px] text-gray-700 hover:bg-gray-100">⬇ Short {s.part}</a>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
