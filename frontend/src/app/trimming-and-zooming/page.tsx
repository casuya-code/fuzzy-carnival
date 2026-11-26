"use client";

import RequireAuth from "@/components/RequireAuth";



import Link from "next/link";

import { Suspense, useEffect, useRef, useState } from "react";

import { useSearchParams } from "next/navigation";

import InfoTip from "@/components/InfoTip";

import OverlayPicker from "@/components/OverlayPicker";

import PlatformAspectPicker from "@/components/PlatformAspectPicker";

import SfxPicker from "@/components/SfxPicker";

import TransitionPicker, {

  DEFAULT_TRANSITION,

  DEFAULT_TRANSITION_DURATION_SEC,

  TRANSITION_OPTIONS,

  transitionLabel,

} from "@/components/TransitionPicker";

import {

  type Language,

  finalizeVideo,

  processVideo,

  processVideoBatch,

  submitVideoJob,

  VideoProcessResult,

  waitForVideoJob,

} from "@/lib/api";

import { mapWithConcurrency } from "@/lib/asyncPool";

import { fmtSize } from "@/lib/format";

import { addDeliverable, addVideoHistory, getDeliverableById, loadSpeechHistory, SpeechHistoryItem } from "@/lib/history";

import {

  DEFAULT_OVERLAY_OPACITY,

  DEFAULT_OVERLAY_POSITION,

  DEFAULT_OVERLAY_SIZE,

  type OverlayPosition,

} from "@/lib/localOverlay";

import { createObjectUrlRegistry } from "@/lib/objectUrls";

import type { AspectRatio } from "@/lib/platformAspects";

import { DEFAULT_SFX, DEFAULT_SFX_LEVEL, type SfxId } from "@/lib/transitionSfx";

import { loadBrandFont } from "@/lib/textStyles";



interface ClipItem {

  id: string;

  file: File;

  url: string;

}



const OVERLAY_EFFECTS = [

  { id: "none", label: "None", tip: "No visual effect overlay." },

  { id: "grain", label: "Grain", tip: "Film grain texture. Subtle, a bit slower." },

  { id: "vignette", label: "Vignette", tip: "Darkened edges. Fast." },

  { id: "lightleak", label: "Light leak", tip: "Soft warm wash. Slower." },

  { id: "snow", label: "Snow", tip: "Falling noise specks. Slower." },

] as const;



function TrimmingAndZoomingPageInner() {

  const [clips, setClips] = useState<ClipItem[]>([]);

  const [aspectRatio, setAspectRatio] = useState<AspectRatio>("9:16");

  const [trimEndSec, setTrimEndSec] = useState(0.5);

  const [defaultTransition, setDefaultTransition] = useState(DEFAULT_TRANSITION);

  const [transitionDuration, setTransitionDuration] = useState(DEFAULT_TRANSITION_DURATION_SEC);

  const [gapTransitions, setGapTransitions] = useState<string[]>([]);

  const [transitionSfx, setTransitionSfx] = useState<SfxId>(DEFAULT_SFX);

  const [sfxLevel, setSfxLevel] = useState(DEFAULT_SFX_LEVEL);

  const [overlayFile, setOverlayFile] = useState<File | null>(null);

  const [overlayPosition, setOverlayPosition] = useState<OverlayPosition>(DEFAULT_OVERLAY_POSITION);

  const [overlaySize, setOverlaySize] = useState(DEFAULT_OVERLAY_SIZE);

  const [overlayOpacity, setOverlayOpacity] = useState(DEFAULT_OVERLAY_OPACITY);

  const [overlayEffect, setOverlayEffect] = useState("none");

  const [audioMode, setAudioMode] = useState<"upload" | "history">("upload");

  const [audioFile, setAudioFile] = useState<File | null>(null);

  const [audioHistory, setAudioHistory] = useState<SpeechHistoryItem[]>([]);

  const [selectedAudioUrl, setSelectedAudioUrl] = useState<string>("");

  const [language, setLanguage] = useState<Language>("en");

  const [upscale2k, setUpscale2k] = useState(false);

  const [quickPreview, setQuickPreview] = useState(false);

  const [backgroundRender, setBackgroundRender] = useState(false);

  const [loudnorm, setLoudnorm] = useState(true);

  const [processing, setProcessing] = useState(false);

  const [progress, setProgress] = useState<string | null>(null);

  const [error, setError] = useState<string | null>(null);

  const [result, setResult] = useState<VideoProcessResult | null>(null);

  const [clipUrls] = useState(createObjectUrlRegistry);

  const clipInputRef = useRef<HTMLInputElement | null>(null);

  const audioInputRef = useRef<HTMLInputElement | null>(null);

  // Reuse unchanged batch intermediates when re-running the same export.

  const batchKeyCache = useRef<Map<string, string>>(new Map());

  const searchParams = useSearchParams();

  const presetId = searchParams.get("preset");

  const presetApplied = useRef(false);



  useEffect(() => {

    if (!presetId || presetApplied.current) return;

    const item = getDeliverableById(presetId);

    const s = item?.meta?.settings as Record<string, any> | undefined;

    if (!s) return;

    presetApplied.current = true;

    if (s.aspect_ratio === "9:16" || s.aspect_ratio === "1:1" || s.aspect_ratio === "16:9") setAspectRatio(s.aspect_ratio);

    if (typeof s.trim_end_sec === "number") setTrimEndSec(s.trim_end_sec);

    if (typeof s.transition === "string") setDefaultTransition(s.transition);

    if (typeof s.transition_duration_sec === "number") setTransitionDuration(s.transition_duration_sec);

    if (typeof s.transition_sfx === "string") setTransitionSfx(s.transition_sfx as SfxId);

    if (typeof s.transition_sfx_level === "number") setSfxLevel(s.transition_sfx_level);

    if (typeof s.overlay_effect === "string") setOverlayEffect(s.overlay_effect);

    if (s.overlay_position === "top-left" || s.overlay_position === "top-right" || s.overlay_position === "bottom-left" || s.overlay_position === "bottom-right") setOverlayPosition(s.overlay_position);

    if (typeof s.overlay_size === "number") setOverlaySize(s.overlay_size);

    if (typeof s.overlay_opacity === "number") setOverlayOpacity(s.overlay_opacity);

    if (typeof s.upscale_2k === "boolean") setUpscale2k(s.upscale_2k);

    if (typeof s.loudnorm === "boolean") setLoudnorm(s.loudnorm);

    if (s.language === "en" || s.language === "sw") setLanguage(s.language);

  }, [presetId]);



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

    setGapTransitions([]);

    if (clipInputRef.current) clipInputRef.current.value = "";

  };



  const effectiveGaps = Array.from(

    { length: Math.max(0, clips.length - 1) },

    (_, i) => gapTransitions[i] || defaultTransition,

  );

  const setGapTransition = (index: number, value: string) => {

    setGapTransitions((prev) => {

      const next = [...prev];

      while (next.length < effectiveGaps.length) next.push(defaultTransition);

      next[index] = value;

      return next;

    });

  };



  const savePreset = () => {

    const name = window.prompt("Preset name", "My edit preset")?.trim().slice(0, 40);

    if (!name) return;

    addDeliverable({

      kind: "preset",

      title: name,

      url: `preset://${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,

      meta: {

        route: "/trimming-and-zooming",

        settings: {

          aspect_ratio: aspectRatio,

          trim_end_sec: trimEndSec,

          transition: defaultTransition,

          transition_duration_sec: transitionDuration,

          transition_sfx: transitionSfx,

          transition_sfx_level: sfxLevel,

          overlay_effect: overlayEffect,

          overlay_position: overlayPosition,

          overlay_size: overlaySize,

          overlay_opacity: overlayOpacity,

          upscale_2k: upscale2k,

          loudnorm,

          language,

        },

      },

    });

    window.alert("Preset saved");

  };



  const runRender = async <T,>(
    kind: "process" | "batch" | "finalize",
    payload: Record<string, unknown>,
    sync: (p: any) => Promise<T>,
  ): Promise<T> => {

    if (!backgroundRender) return sync(payload as any);

    const accepted = await submitVideoJob(kind, payload);

    const done = await waitForVideoJob(accepted.job_id, {

      onProgress: (s) => setProgress(`${s.stage} ${Math.round(s.progress)}%…`),

    });

    return done.result as T;

  };



  const process = async () => {

    setError(null);

    setResult(null);

    setProgress(null);

    if (clips.length === 0) { setError("Add at least one video clip."); return; }

    if (overlayFile && overlayFile.size > 10 * 1024 * 1024) {

      setError("Overlay image must be 10 MB or smaller.");

      return;

    }



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



      // For larger jobs, split into smaller batch requests to avoid upload/timeouts.

      // SFX and overlays stay on the direct path so every cut and frame is covered.

      const BATCH_SIZE = 5;

      if (files.length > BATCH_SIZE && transitionSfx === "off" && !overlayFile) {

        const totalBatches = Math.ceil(files.length / BATCH_SIZE);

        const batchPayloads = Array.from({ length: totalBatches }, (_, b) => {

          const start = b * BATCH_SIZE;

          return {

            start,

            batchFiles: files.slice(start, start + BATCH_SIZE),

            payload: {

              clips: files.slice(start, start + BATCH_SIZE),

              aspect_ratio: aspectRatio,

              trim_end_sec: trimEndSec,

              topic,

              language,

              // Forward the selected audio so batch jobs get beat-synced zoom too.

              // No bpm is computed on this page — the backend derives it from the audio.

              audio: audioPayload.file,

              audio_r2_key: audioPayload.key,

              transition: defaultTransition,

              transition_duration_sec: transitionDuration,

              transitions: effectiveGaps.slice(start, start + Math.min(BATCH_SIZE, files.length - start) - 1),

              overlay: overlayEffect,

              preview: quickPreview,

            },

          };

        });

        // Two independent batch requests at a time; results are written back by index.

        const batchKeys = await mapWithConcurrency(batchPayloads, 2, async ({ start, batchFiles, payload }, b) => {

          const audioIdentity = audioPayload.file

            ? `${audioPayload.file.name}:${audioPayload.file.size}:${audioPayload.file.lastModified}`

            : audioPayload.key;

          const signature = JSON.stringify({

            clips: batchFiles.map((f) => [f.name, f.size, f.lastModified]),

            start,

            aspectRatio,

            trimEndSec,

            overlayEffect,

            language,

            topic,

            audioIdentity,

            gaps: payload.transitions,

            quickPreview,

          });

          const cached = batchKeyCache.current.get(signature);

          if (cached) {

            setProgress(`Reusing exported batch ${b + 1}/${totalBatches}…`);

            return cached;

          }

          setProgress(`Processing clips ${start + 1}-${Math.min(start + batchFiles.length, files.length)} of ${files.length} (batch ${b + 1}/${totalBatches})…`);

          const batch = await runRender("batch", payload, processVideoBatch);

          if (!batch.video_r2_key) throw new Error("Batch processing did not return a video key.");

          batchKeyCache.current.set(signature, batch.video_r2_key);

          return batch.video_r2_key;

        });

        const boundaryGaps = Array.from({ length: Math.max(0, batchKeys.length - 1) }, (_, i) =>

          effectiveGaps[(i + 1) * BATCH_SIZE - 1] || defaultTransition,

        );

        setProgress(`Finalizing video (${batchKeys.length} batches) with audio…`);

        data = await runRender("finalize", {

          video_r2_keys: batchKeys,

          audio: audioPayload.file,

          audio_r2_key: audioPayload.key,

          aspect_ratio: aspectRatio,

          topic,

          language,

          upscale_2k: upscale2k,

          loudnorm,

          transition: defaultTransition,

          transition_duration_sec: transitionDuration,

          transitions: boundaryGaps,

          transition_sfx: transitionSfx,

          transition_sfx_level: sfxLevel,

          overlay_image: overlayFile,

          overlay_position: overlayPosition,

          overlay_size: overlaySize,

          overlay_opacity: overlayOpacity,

          overlay: overlayEffect,

          font_path: loadBrandFont()?.font_path,

          preview: quickPreview,

        }, finalizeVideo);

      } else {

        setProgress("Processing clips and attaching audio…");

        data = await runRender("process", {

          clips: files,

          audio: audioPayload.file,

          audio_r2_key: audioPayload.key,

          aspect_ratio: aspectRatio,

          trim_end_sec: trimEndSec,

          topic,

          language,

          upscale_2k: upscale2k,

          loudnorm,

          transition: defaultTransition,

          transition_duration_sec: transitionDuration,

          transitions: effectiveGaps,

          transition_sfx: transitionSfx,

          transition_sfx_level: sfxLevel,

          overlay_image: overlayFile,

          overlay_position: overlayPosition,

          overlay_size: overlaySize,

          overlay_opacity: overlayOpacity,

          overlay: overlayEffect,

          font_path: loadBrandFont()?.font_path,

          preview: quickPreview,

        }, processVideo);

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

          transition: defaultTransition,

          transition_duration_sec: transitionDuration,

          transition_sfx: transitionSfx,

          transition_sfx_level: sfxLevel,

          overlay: overlayEffect,

          overlay_image: overlayFile?.name || null,

          overlay_position: overlayPosition,

          overlay_size: overlaySize,

          overlay_opacity: overlayOpacity,

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

        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">

          <div>

            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">✂️ Edit Video</h1>

            <p className="mt-2 text-sm sm:text-base text-gray-600 max-w-3xl">

              Assemble clips and add audio.{" "}

              <InfoTip text="Trim ends, pick a shape, then attach your audio." label="Editing steps" />

            </p>

          </div>

          <button

            type="button"

            onClick={savePreset}

            className="shrink-0 rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"

          >

            Save preset <InfoTip text="Save these edit settings to My Files for reuse." label="Save preset" focusable={false} />

          </button>

        </div>

        <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2 text-center">

          {[

            { label: "Clips", value: clips.length },

            { label: "Trim", value: `${trimEndSec.toFixed(1)}s` },

            { label: "Shape", value: aspectRatio },

            { label: "Zoom", value: "Auto" },

            { label: "Transition", value: transitionLabel(defaultTransition) },

            { label: "SFX", value: transitionSfx === "off" ? "Off" : `${transitionSfx} ${sfxLevel}%` },

            { label: "Overlay", value: overlayEffect !== "none" ? overlayEffect : (overlayFile ? `${overlaySize}%` : "Off") },

          ].map((m) => (

            <div key={m.label} className="rounded-lg border bg-gradient-to-b from-gray-50 to-white px-2 py-2">

              <div className="text-[10px] uppercase tracking-wide text-gray-400">

                {m.label}{" "}

                {m.label === "Zoom" && <InfoTip text="Zoom follows the audio beat when available." label="Zoom mode" />}

                {m.label === "Transition" && <InfoTip text="Applied between adjacent clips. Per-gap choices override this default." label="Transition mode" />}

              </div>

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

              ∅ &nbsp; No clips yet. <InfoTip text="Add one or more videos from your device." label="Adding clips" placement="bottom" />

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

          <p className="text-[11px] text-gray-400">Clips are trimmed, zoomed, and stitched in order.{" "}

            <InfoTip text={`Zoom follows the audio beat; otherwise a fixed 2.5s cycle. Each clip trims ${trimEndSec}s from its tail.`} label="Clip processing" placement="bottom" />

          </p>

        </section>



        {/* Transitions */}

        <section className="rounded-xl border bg-white p-4 sm:p-5 shadow-sm space-y-4 min-w-0">

          <div className="flex items-center justify-between gap-2 border-b pb-2">

            <h2 className="text-base sm:text-lg font-semibold">② Transitions</h2>

            <span className="rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-mono text-blue-700">

              {Math.max(0, clips.length - 1)} gaps

            </span>

          </div>



          <div className="grid gap-4 sm:grid-cols-2">

            <div className="rounded-lg border p-3 space-y-3">

              <TransitionPicker value={defaultTransition} onChange={setDefaultTransition} />

              <label className="block space-y-1">

                <span className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-gray-400 font-semibold">

                  Time

                  <InfoTip

                    text="0.1–1.5s. Longer overlaps look smoother but shorten the finished video."

                    label="Transition duration"

                  />

                </span>

                <span className="flex items-center gap-2">

                  <input

                    type="range"

                    min={0.1}

                    max={1.5}

                    step={0.1}

                    value={transitionDuration}

                    onChange={(e) => setTransitionDuration(parseFloat(e.target.value))}

                    className="w-full accent-blue-600"

                  />

                  <span className="w-10 text-right font-mono text-xs tabular-nums">{transitionDuration.toFixed(1)}s</span>

                </span>

              </label>

              <SfxPicker

                value={transitionSfx}

                level={sfxLevel}

                onValueChange={setTransitionSfx}

                onLevelChange={setSfxLevel}

              />

            </div>



            <div className="rounded-lg border p-3 space-y-2">

              <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-gray-400 font-semibold">

                Per gap

                <InfoTip

                  text="Overrides the default for that boundary. Large jobs also apply these at batch boundaries."

                  label="Per-gap transitions"

                />

              </div>

              {effectiveGaps.length === 0 ? (

                <p className="text-xs text-gray-400">Add two or more clips to set a transition.</p>

              ) : (

                <div className="max-h-56 space-y-1.5 overflow-y-auto scrollbar-autohide pr-1">

                  {effectiveGaps.map((gap, i) => (

                    <div key={i} className="flex items-center gap-2">

                      <span className="w-12 shrink-0 font-mono text-[11px] text-gray-400">{i + 1}→{i + 2}</span>

                      <select

                        value={gap}

                        onChange={(e) => setGapTransition(i, e.target.value)}

                        className="min-w-0 flex-1 rounded-md border border-gray-300 px-2 py-1 text-xs"

                        aria-label={`Transition before clip ${i + 2}`}

                      >

                        {TRANSITION_OPTIONS.map((option) => (

                          <option key={option.id} value={option.id}>{option.label}</option>

                        ))}

                      </select>

                    </div>

                  ))}

                </div>

              )}

            </div>

          </div>

        </section>



        {/* Local overlay */}

        <section className="rounded-xl border bg-white p-4 sm:p-5 shadow-sm min-w-0">

          <div className="flex items-center justify-between gap-2 border-b pb-2">

            <h2 className="text-base sm:text-lg font-semibold">③ Overlays</h2>

            <span className="rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-mono text-blue-700">

              {overlayEffect !== "none" || overlayFile ? "On" : "Off"}

            </span>

          </div>

          <div className="pt-3 space-y-4">

            <div className="space-y-2">

              <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-gray-400 font-semibold">

                Effect <InfoTip text="Visual overlay applied to the video. 'None' keeps the current look." label="Effect overlay" />

              </div>

              <div className="flex flex-wrap gap-2">

                {OVERLAY_EFFECTS.map((opt) => (

                  <button

                    key={opt.id}

                    type="button"

                    onClick={() => setOverlayEffect(opt.id)}

                    className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${

                      overlayEffect === opt.id ? "border-blue-500 bg-blue-600 text-white" : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50"

                    }`}

                  >

                    {opt.label}

                    <InfoTip text={opt.tip} label={opt.label} focusable={false} />

                  </button>

                ))}

              </div>

            </div>

            <div className="border-t pt-3">

              <OverlayPicker

                file={overlayFile}

                position={overlayPosition}

                size={overlaySize}

                opacity={overlayOpacity}

                onFileChange={setOverlayFile}

                onPositionChange={setOverlayPosition}

                onSizeChange={setOverlaySize}

                onOpacityChange={setOverlayOpacity}

              />

            </div>

          </div>

        </section>



        {/* Audio + settings */}

        <section className="rounded-xl border bg-white p-4 sm:p-5 shadow-sm space-y-4 min-w-0">

          <div className="flex items-center justify-between gap-2 border-b pb-2">

            <h2 className="text-base sm:text-lg font-semibold">④ Unified Audio &amp; Parameters</h2>

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

                    <PlatformAspectPicker value={aspectRatio} onChange={setAspectRatio} className="max-w-sm" />

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

                  <td className="px-3 py-3 text-xs text-gray-500">Auto (beat-synced){" "}

                    <InfoTip text="Beat-synced to attached audio when available (1.0→1.14×), otherwise a fixed 2.5s cycle (1.0→1.12×). Not adjustable here." label="Zoom cycle" placement="bottom" />

                  </td>

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

                <span className="font-medium">Normalize loudness <InfoTip text="Balance voice/music level for social playback (recommended)." label="Loudness" focusable={false} /></span>

              </span>

            </label>

            <label className="flex items-start gap-2 text-sm text-gray-700 cursor-pointer select-none">

              <input type="checkbox" checked={upscale2k} onChange={(e) => setUpscale2k(e.target.checked)} className="mt-0.5" />

              <span>

                <span className="font-medium">YouTube 2K upscale <InfoTip text="Export at higher resolution (e.g. 2560×1440 for 16:9) for sharper YouTube delivery. Slower to render." label="Upscaling" focusable={false} /></span>

              </span>

            </label>

            <label className="flex items-start gap-2 text-sm text-gray-700 cursor-pointer select-none">

              <input type="checkbox" checked={quickPreview} onChange={(e) => setQuickPreview(e.target.checked)} className="mt-0.5" />

              <span>

                <span className="font-medium">Quick low-resolution preview <InfoTip text="Renders a fast 480px-wide draft with every effect still applied. Turn it off for the full-quality final export." label="Quick preview" focusable={false} /></span>

              </span>

            </label>

            <label className="flex items-start gap-2 text-sm text-gray-700 cursor-pointer select-none">

              <input type="checkbox" checked={backgroundRender} onChange={(e) => setBackgroundRender(e.target.checked)} className="mt-0.5" />

              <span>

                <span className="font-medium">Render in background <InfoTip text="Queue the render as a job with live progress and cancellation instead of blocking this page." label="Background render" focusable={false} /></span>

              </span>

            </label>

          </div>



          <div className="rounded-lg border p-3 space-y-3">

            <div className="text-[11px] uppercase tracking-wide text-gray-400 font-semibold">Audio <InfoTip text="One mixed track for voice and music." label="Audio source" /></div>

            <div className="grid grid-cols-2 gap-2">

              <button type="button" onClick={() => setAudioMode("upload")} className={`rounded-md border px-3 py-2 text-xs sm:text-sm font-medium ${audioMode === "upload" ? "border-gray-800 bg-gray-800 text-white" : "border-gray-200 hover:bg-gray-50"}`}>📁 Upload audio</button>

              <button type="button" onClick={() => setAudioMode("history")} className={`rounded-md border px-3 py-2 text-xs sm:text-sm font-medium ${audioMode === "history" ? "border-gray-800 bg-gray-800 text-white" : "border-gray-200 hover:bg-gray-50"}`}>🕘 From history</button>

            </div>



            {audioMode === "upload" ? (

              <div className="space-y-2">

                <input ref={audioInputRef} type="file" accept="audio/*,.mp3,.wav,.m4a,.aac" className="hidden" onChange={(e) => setAudioFile(e.target.files?.[0] || null)} />

                <button type="button" onClick={() => audioInputRef.current?.click()} className="w-full rounded-lg border-2 border-dashed border-gray-300 p-3 text-sm text-gray-600 hover:border-blue-400 hover:bg-blue-50">

                  {audioFile ? `Selected: ${audioFile.name} (${fmtSize(audioFile.size)})` : <>Choose audio file <InfoTip text="MP3, WAV or AAC." label="Audio formats" placement="bottom" focusable={false} /></>}

                </button>

              </div>

            ) : (

              <div className="space-y-2">

                <select value={selectedAudioUrl} onChange={(e) => selectHistoryAudio(e.target.value)} className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm">

                  <option value="">Select saved audio…</option>

                  {audioHistory.map((a) => (

                    <option key={a.audio_url} value={a.audio_url}>

                      {(a.engine_used || "audio")} — {a.audio_r2_key?.split("/").pop()?.slice(0, 14)}{a.duration_seconds ? ` (${a.duration_seconds.toFixed(1)}s)` : ""}

                    </option>

                  ))}

                </select>

                {selectedAudio && <audio controls src={selectedAudio.audio_url} className="w-full h-8" />}

                {audioHistory.length === 0 && <p className="text-[11px] text-gray-400">No saved audio. <InfoTip text="Create audio in Speech or Mix Audio, or upload a file." label="Saved audio" placement="bottom" /></p>}

              </div>

            )}

            <p className="text-[11px] text-gray-400">Video loops to match audio. <InfoTip text="Output ends with the audio track (-shortest)." label="Video length" placement="bottom" /></p>

          </div>

        </section>

      </div>



      {/* Process & output */}

      <section className="rounded-xl border bg-white p-4 sm:p-5 shadow-sm space-y-4">

        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-b pb-2">

          <h2 className="text-base sm:text-lg font-semibold">⑤ Process &amp; Export</h2>

          <span className="text-[11px] font-mono text-gray-400">

            {clips.length > 0 && ((audioMode === "upload" && audioFile) || (audioMode === "history" && selectedAudioUrl)) ? "Ready" : "Not ready"} <InfoTip text="Clips and audio are selected." label="Readiness" placement="bottom" />

          </span>

        </div>



        {error && <p className="rounded-md bg-red-50 border border-red-100 p-2 text-sm text-red-700">{error}</p>}



        <button

          onClick={process}

          disabled={processing || clips.length === 0 || (audioMode === "upload" ? !audioFile : !selectedAudioUrl)}

          className="rounded-md bg-purple-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed"

        >

          {processing ? <>Processing… <InfoTip text="Trim → zoom → transition → overlay → mux." label="Processing steps" placement="bottom" focusable={false} /></> : "Process video"}

        </button>



        {processing && (

          <p className="text-xs text-amber-600 font-mono">

            {progress || "Rendering…"} <InfoTip text="Running FFmpeg on CPU. Large jobs run in smaller batches to avoid failures." label="Rendering" placement="bottom" />

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

                Add captions →

              </Link>

              <span className="text-[11px] text-gray-500 font-mono truncate max-w-full">{result.video_r2_key || "video output"}</span>

            </div>

          </div>

        )}

      </section>

    </div>

  );

}

export default function TrimmingAndZoomingPage() {
  return <RequireAuth><Suspense fallback={<div className="p-6 text-sm text-gray-500">Loading…</div>}><TrimmingAndZoomingPageInner /></Suspense></RequireAuth>;
}
