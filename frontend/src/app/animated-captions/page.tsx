"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import InfoTip from "@/components/InfoTip";
import PlatformAspectPicker from "@/components/PlatformAspectPicker";
import TextStylePicker from "@/components/TextStylePicker";
import {
  type Language,
  burnCaptions,
  CaptionPreview,
  previewCaptions,
  processVideo,
} from "@/lib/api";
import { fmtSize } from "@/lib/format";
import {
  addDeliverable,
  addVideoHistory,
  getDeliverableById,
  loadSpeechHistory,
  loadVideoHistory,
  SpeechHistoryItem,
  VideoHistoryItem,
} from "@/lib/history";
import { getMediaDuration } from "@/lib/media";
import { createObjectUrlRegistry } from "@/lib/objectUrls";
import {
  type LowerThird,
  type TextStyle,
  DEFAULT_TEXT_STYLE,
  EMPTY_LOWER_THIRD,
  hasLowerThird,
  loadLowerThird,
  loadTextStyle,
  loadBrandFont,
  resolveLowerThird,
  resolveTextStyle,
  saveLowerThird,
  saveTextStyle,
  stylePreviewCss,
} from "@/lib/textStyles";

interface ClipItem { id: string; file: File; url: string; }
interface CaptionResult {
  video_r2_key?: string;
  video_url: string;
  duration_seconds?: number;
  ass_r2_key?: string;
  ass_url?: string;
  warning?: string;
  word_count?: number;
  chunk_count?: number;
  voice_duration_seconds?: number;
  intro_delay_sec?: number;
}

type SourceMode = "device" | "history" | "fresh";
type Aspect = "9:16" | "1:1" | "16:9";

// Fallback mirror of backend SAFE_ZONES for the visual safe-zone preview before
// an API preview has run. Live values are replaced by `preview.style` below.
const ZONES: Record<Aspect, { w: number; h: number; font: number; ml: number; mr: number; mv: number }> = {
  "9:16": { w: 1080, h: 1920, font: 78, ml: 90, mr: 160, mv: 520 },
  "1:1": { w: 1080, h: 1080, font: 72, ml: 80, mr: 80, mv: 180 },
  "16:9": { w: 1920, h: 1080, font: 68, ml: 140, mr: 140, mv: 120 },
};

function AnimatedCaptionsPageInner() {
  const searchParams = useSearchParams();
  const presetId = searchParams.get("preset");
  const presetApplied = useRef(false);
  const [sourceMode, setSourceMode] = useState<SourceMode>("history");
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [deviceDuration, setDeviceDuration] = useState<number>(0);
  const [videoHistory, setVideoHistory] = useState<VideoHistoryItem[]>([]);
  const [selectedVideoUrl, setSelectedVideoUrl] = useState("");

  const [clips, setClips] = useState<ClipItem[]>([]);
  const [audioMode, setAudioMode] = useState<"upload" | "history">("history");
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [speechHistory, setSpeechHistory] = useState<SpeechHistoryItem[]>([]);
  const [selectedAudioUrl, setSelectedAudioUrl] = useState("");

  const [scriptText, setScriptText] = useState("");
  const [language, setLanguage] = useState<Language>("en");
  const [topic, setTopic] = useState("Untitled");
  const [introDelay, setIntroDelay] = useState(1.5);
  const [outroSec, setOutroSec] = useState(2.5);
  const [voiceDuration, setVoiceDuration] = useState<number | null>(null);
  const [autoVoiceDuration, setAutoVoiceDuration] = useState(true);
  const [aspectRatio, setAspectRatio] = useState<Aspect>("9:16");
  const [wordsPerChunk, setWordsPerChunk] = useState(3);
  const [trimEndSec, setTrimEndSec] = useState(0.5);
  // Start from server-safe defaults; stored styling is restored after mount.
  const [textStyle, setTextStyle] = useState<TextStyle>({ ...DEFAULT_TEXT_STYLE });
  const [lowerThird, setLowerThird] = useState<LowerThird>({ ...EMPTY_LOWER_THIRD });
  const [styleReady, setStyleReady] = useState(false);
  const [lowerReady, setLowerReady] = useState(false);
  const [lowerThirdDuration, setLowerThirdDuration] = useState(5);

  const [preview, setPreview] = useState<CaptionPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [activeWord, setActiveWord] = useState(0);
  const [upscale2k, setUpscale2k] = useState(false);
  const [loudnorm, setLoudnorm] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CaptionResult | null>(null);

  const videoInputRef = useRef<HTMLInputElement | null>(null);
  const clipInputRef = useRef<HTMLInputElement | null>(null);
  const audioInputRef = useRef<HTMLInputElement | null>(null);
  const [clipUrls] = useState(createObjectUrlRegistry);

  // Rendered karaoke words (the preview highlights these, not the full script).
  const demoWords = scriptText.trim()
    ? scriptText.trim().split(/\s+/).slice(0, wordsPerChunk)
    : [];

  // Restore handoffs from earlier pages
  useEffect(() => {
    const videos = loadVideoHistory();
    setVideoHistory(videos);
    // Trimming & Zooming hands off a freshly created video via ?video_url=...
    const handoffUrl = new URLSearchParams(window.location.search).get("video_url");
    const initialVideo = (handoffUrl && videos.find((v) => v.video_url === handoffUrl)) || videos[0];
    if (initialVideo) {
      setSelectedVideoUrl(initialVideo.video_url);
      setSourceMode("history");
    }
    const speeches = loadSpeechHistory();
    setSpeechHistory(speeches);
    const initialSpeech = speeches.find((s) => s.source_text) || speeches[0];
    if (initialSpeech) {
      setSelectedAudioUrl(initialSpeech.audio_url);
      if (initialSpeech.source_text) setScriptText((current) => (current.trim() ? current : initialSpeech.source_text!));
    }
    // Video handoff wins for language/topic; otherwise inherit from the speech.
    const initialLang = initialVideo?.language || initialSpeech?.language;
    const initialTopic = initialVideo?.topic || initialSpeech?.topic;
    if (initialLang) setLanguage(initialLang);
    if (initialTopic) setTopic(initialTopic);
  }, []);

  useEffect(() => {
    return () => clipUrls.revokeAll();
  }, [clipUrls]);

  useEffect(() => {
    setTextStyle(loadTextStyle());
    setStyleReady(true);
  }, []);

  useEffect(() => {
    setLowerThird(loadLowerThird());
    setLowerReady(true);
  }, []);

  // Keep the chosen typography available on the publish page too.
  useEffect(() => {
    if (!styleReady) return;
    saveTextStyle(textStyle);
    setPreview(null);
  }, [textStyle, styleReady]);

  useEffect(() => {
    if (!lowerReady) return;
    saveLowerThird(lowerThird);
    setPreview(null);
  }, [lowerThird, lowerThirdDuration, lowerReady]);

  useEffect(() => {
    if (!presetId || presetApplied.current) return;
    const item = getDeliverableById(presetId);
    const s = item?.meta?.settings as Record<string, any> | undefined;
    if (!s) return;
    presetApplied.current = true;
    if (s.aspect_ratio === "9:16" || s.aspect_ratio === "1:1" || s.aspect_ratio === "16:9") setAspectRatio(s.aspect_ratio);
    if (typeof s.words_per_chunk === "number") setWordsPerChunk(Math.max(1, Math.min(8, Math.round(s.words_per_chunk))));
    if (typeof s.intro_delay_sec === "number") setIntroDelay(s.intro_delay_sec);
    if (typeof s.outro_sec === "number") setOutroSec(s.outro_sec);
    if (typeof s.trim_end_sec === "number") setTrimEndSec(s.trim_end_sec);
    if (s.text_style) setTextStyle(resolveTextStyle(s.text_style));
    if (s.lower_third) setLowerThird(resolveLowerThird(s.lower_third));
    if (typeof s.lower_third_duration_sec === "number") setLowerThirdDuration(s.lower_third_duration_sec);
    if (typeof s.topic === "string") setTopic(s.topic);
    if (s.language === "en" || s.language === "sw") setLanguage(s.language);
  }, [presetId]);

  // Live karaoke demo: cycle the highlighted word over the actually rendered demoWords
  useEffect(() => {
    if (!preview || preview.word_timings.length === 0 || demoWords.length === 0) return;
    const count = Math.min(demoWords.length, preview.word_timings.length);
    const id = setInterval(() => setActiveWord((i) => (i + 1) % Math.max(1, count)), 700);
    return () => clearInterval(id);
  }, [preview, demoWords.length]);

  const selectedVideo = videoHistory.find((v) => v.video_url === selectedVideoUrl);
  const selectedAudio = speechHistory.find((a) => a.audio_url === selectedAudioUrl);

  // Selecting a saved speech pre-fills its script/language/topic when available.
  const selectSpeech = (url: string) => {
    setSelectedAudioUrl(url);
    setPreview(null);
    const s = speechHistory.find((a) => a.audio_url === url);
    if (s) {
      if (s.source_text) setScriptText((current) => (current.trim() ? current : s.source_text!));
      if (s.language) setLanguage(s.language);
      if (s.topic) setTopic(s.topic);
    }
  };
  const useSavedScript = () => {
    if (!selectedAudio?.source_text) return;
    setScriptText(selectedAudio.source_text);
    setPreview(null);
  };

  const knownDuration =
    sourceMode === "device" ? deviceDuration
    : sourceMode === "history" ? (selectedVideo?.duration_seconds || 0)
    : (selectedAudio?.duration_seconds || 0);

  const effectiveVoiceDuration = useMemo(() => {
    if (!autoVoiceDuration && voiceDuration) return voiceDuration;
    if (knownDuration <= introDelay) return 0;
    return Math.max(1, knownDuration - introDelay - outroSec);
  }, [autoVoiceDuration, voiceDuration, knownDuration, introDelay, outroSec]);

  const wordCount = scriptText.trim() ? scriptText.trim().split(/\s+/).length : 0;
  const fallbackZone = ZONES[aspectRatio];
  const zone = preview
    ? {
        w: preview.style.play_res[0],
        h: preview.style.play_res[1],
        font: preview.style.font_size,
        ml: preview.style.margin_l,
        mr: preview.style.margin_r,
        mv: preview.style.margin_v,
      }
    : fallbackZone;
  const demoStyle = stylePreviewCss(textStyle);

  const sourceReady =
    sourceMode === "device" ? !!videoFile
    : sourceMode === "history" ? !!selectedVideo
    : clips.length > 0 && (audioMode === "upload" ? !!audioFile : !!selectedAudioUrl);

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

  const doPreview = async () => {
    setPreviewError(null);
    setPreview(null);
    if (!scriptText.trim() && !hasLowerThird(lowerThird)) { setPreviewError("Write a script or fill a lower third first."); return; }
    if (effectiveVoiceDuration <= 0) { setPreviewError("Select a video/audio with a known duration (or set voice duration manually)."); return; }
    try {
      const p = await previewCaptions({
        script_text: scriptText.trim(),
        voice_duration: effectiveVoiceDuration,
        intro_delay_sec: introDelay,
        aspect_ratio: aspectRatio,
        words_per_chunk: wordsPerChunk,
        caption_style: textStyle,
        lower_third: lowerThird,
        lower_third_duration_sec: lowerThirdDuration,
      });
      setPreview(p);
      setActiveWord(0);
    } catch (e: any) {
      setPreviewError(e?.message || "Preview failed");
    }
  };

  const generate = async () => {
    setError(null);
    setResult(null);
    if (!sourceReady) { setError("Choose a video source (device / history / fresh clips)."); return; }
    if (!scriptText.trim() && !hasLowerThird(lowerThird)) { setError("Write a script or fill a lower third first."); return; }

    setProcessing(true);
    try {
      let data: CaptionResult;
      if (sourceMode === "fresh") {
        data = await processVideo({
          clips: clips.map((c) => c.file),
          audio: audioMode === "upload" ? audioFile : null,
          audio_r2_key: audioMode === "history" ? selectedAudio?.audio_r2_key : null,
          script_text: scriptText.trim(),
          intro_delay_sec: introDelay,
          outro_sec: outroSec,
          aspect_ratio: aspectRatio,
          words_per_chunk: wordsPerChunk,
          trim_end_sec: trimEndSec,
          language,
          topic,
          upscale_2k: upscale2k,
          loudnorm,
          caption_style: textStyle,
          lower_third: lowerThird,
          lower_third_duration_sec: lowerThirdDuration,
          font_path: loadBrandFont()?.font_path,
        });
      } else {
        data = await burnCaptions({
          video: sourceMode === "device" ? videoFile : null,
          video_r2_key: sourceMode === "history" ? selectedVideo?.video_r2_key : null,
          script_text: scriptText.trim(),
          intro_delay_sec: introDelay,
          voice_duration: autoVoiceDuration ? null : voiceDuration,
          outro_sec: outroSec,
          aspect_ratio: aspectRatio,
          words_per_chunk: wordsPerChunk,
          language,
          topic,
          upscale_2k: upscale2k,
          loudnorm,
          caption_style: textStyle,
          lower_third: lowerThird,
          lower_third_duration_sec: lowerThirdDuration,
          font_path: loadBrandFont()?.font_path,
        });
      }
      setResult(data);
      setVideoHistory(addVideoHistory({
        video_r2_key: data.video_r2_key,
        video_url: data.video_url,
        duration_seconds: data.duration_seconds,
        aspect_ratio: aspectRatio,
        language,
        topic,
        engine_used: "animated captions",
      }));
      // Select the newly created video so it can be reused immediately.
      setSelectedVideoUrl(data.video_url);
      addDeliverable({
        kind: "captioned",
        title: `Animated captions (${data.word_count ?? 0} words)`,
        url: data.video_url,
        r2_key: data.video_r2_key,
        meta: {
          duration_seconds: data.duration_seconds,
          aspect_ratio: aspectRatio,
          ass_url: data.ass_url,
          voice_duration_seconds: data.voice_duration_seconds,
          intro_delay_sec: data.intro_delay_sec,
        },
      });
    } catch (e: any) {
      setError(e?.message || "Caption generation failed");
    } finally {
      setProcessing(false);
    }
  };

  const pct = (n: number, total: number) => `${(n / total) * 100}%`;

  const savePreset = () => {
    const name = window.prompt("Preset name", "My caption preset")?.trim().slice(0, 40);
    if (!name) return;
    addDeliverable({
      kind: "preset",
      title: name,
      url: `preset://${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      meta: {
        route: "/animated-captions",
        settings: {
          aspect_ratio: aspectRatio,
          words_per_chunk: wordsPerChunk,
          intro_delay_sec: introDelay,
          outro_sec: outroSec,
          trim_end_sec: trimEndSec,
          lower_third_duration_sec: lowerThirdDuration,
          text_style: textStyle,
          lower_third: lowerThird,
          topic, language,
        },
      },
    });
    window.alert("Preset saved");
  };

  return (
    <div className="space-y-6 pb-10">
      <header className="rounded-xl border bg-white p-4 sm:p-5 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">💬 Add Captions</h1>
            <p className="mt-2 text-sm sm:text-base text-gray-600 max-w-3xl">
              Add captions to your video.{" "}
              <InfoTip text="Preview timing and style before rendering." label="Caption workflow" />
            </p>
          </div>
          <button
            type="button"
            onClick={savePreset}
            className="shrink-0 rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
          >
            Save preset <InfoTip text="Save these caption settings to My Files for reuse." label="Save preset" focusable={false} />
          </button>
        </div>
        <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
          {[
            { label: "Words", value: preview?.word_count ?? wordCount },
            { label: "Chunks", value: preview?.chunk_count ?? Math.ceil(wordCount / wordsPerChunk) },
            { label: "Layout", value: aspectRatio },
            { label: "Voice", value: `${effectiveVoiceDuration.toFixed(1)}s` },
          ].map((m) => (
            <div key={m.label} className="rounded-lg border bg-gradient-to-b from-gray-50 to-white px-2 py-2">
              <div className="text-[10px] uppercase tracking-wide text-gray-400">
                {m.label}{" "}
                {m.label === "Voice" && <InfoTip text="Narration length used for timing." label="Voice duration" />}
              </div>
              <div className="text-sm sm:text-base font-semibold font-mono text-gray-800 tabular-nums">{m.value}</div>
            </div>
          ))}
        </div>
      </header>

      <div className="grid gap-6 xl:grid-cols-2">
        {/* Left: source + script */}
        <div className="space-y-6 min-w-0">
          <section className="rounded-xl border bg-white p-4 sm:p-5 shadow-sm space-y-4">
            <div className="flex items-center justify-between gap-2 border-b pb-2">
              <h2 className="text-base sm:text-lg font-semibold">① Video source</h2>
              <span className="text-[11px] font-mono text-gray-400">3 sources <InfoTip text="Use a saved video, a device file, or fresh clips." label="Video sources" placement="bottom" /></span>
            </div>

            <div className="grid grid-cols-3 gap-2">
              {([
                { id: "history", label: "🕘 From Trimming", sub: "Saved" },
                { id: "device", label: "📁 From device", sub: "Upload" },
                { id: "fresh", label: "🎬 Fresh (1-pass)", sub: "New" },
              ] as { id: SourceMode; label: string; sub: string }[]).map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => { setSourceMode(m.id); setPreview(null); setResult(null); }}
                  className={`rounded-lg border px-2 py-2 text-center text-xs sm:text-sm font-medium transition ${sourceMode === m.id ? "border-blue-500 bg-blue-600 text-white" : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50"}`}
                >
                  <div>{m.label}</div>
                  <div className={`text-[10px] font-normal ${sourceMode === m.id ? "text-blue-100" : "text-gray-400"}`}>{m.sub}{" "}
                    <InfoTip
                      text={m.id === "history" ? "Uses a video passed from Trimming & Zooming." : m.id === "device" ? "Choose a file from your device." : "Build a video from clips and audio in one pass."}
                      label={`${m.sub} source`}
                      placement="bottom"
                      focusable={false}
                    />
                  </div>
                </button>
              ))}
            </div>

            {sourceMode === "history" && (
              <div className="space-y-2">
                <select value={selectedVideoUrl} onChange={(e) => { setSelectedVideoUrl(e.target.value); setPreview(null); }} className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm">
                  <option value="">Select a video…</option>
                  {videoHistory.map((v) => (
                    <option key={v.video_url} value={v.video_url}>
                      {(v.engine_used || "video")} — {v.video_r2_key?.split("/").pop()?.slice(0, 14)}{v.duration_seconds ? ` (${v.duration_seconds.toFixed(1)}s)` : ""}{v.aspect_ratio ? ` ${v.aspect_ratio}` : ""}{v.clips_processed != null ? ` · ${v.clips_processed} clips` : ""}
                    </option>
                  ))}
                </select>
                {videoHistory.length === 0 && (
                  <p className="text-[11px] text-gray-400">No videos yet. <InfoTip text="Create one in Edit Video or upload from your device." label="Video sources" placement="bottom" /></p>
                )}
                {selectedVideo && (
                  <div className="space-y-2">
                    <video controls src={selectedVideo.video_url} className="w-full rounded-lg bg-black max-h-64" />
                    <p className="text-[11px] font-mono text-gray-500 truncate">{selectedVideo.video_r2_key || selectedVideo.video_url}</p>
                  </div>
                )}
              </div>
            )}

            {sourceMode === "device" && (
              <div className="space-y-2">
                <input
                  ref={videoInputRef}
                  type="file"
                  accept="video/*,.mp4,.mov,.webm,.mkv"
                  className="hidden"
                  onChange={async (e) => {
                    const f = e.target.files?.[0] || null;
                    setVideoFile(f); setPreview(null); setResult(null);
                    setDeviceDuration(f ? await getMediaDuration(f, "video") : 0);
                    e.target.value = "";
                  }}
                />
                <button type="button" onClick={() => videoInputRef.current?.click()} className="w-full rounded-lg border-2 border-dashed border-gray-300 p-4 text-sm text-gray-600 hover:border-blue-400 hover:bg-blue-50">
                  {videoFile ? `Selected: ${videoFile.name} (${fmtSize(videoFile.size)} · ${deviceDuration.toFixed(1)}s)` : <>Choose video file <InfoTip text="MP4, MOV or WEBM." label="Video formats" placement="bottom" focusable={false} /></>}
                </button>
              </div>
            )}

            {sourceMode === "fresh" && (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <input ref={clipInputRef} type="file" accept="video/*,.mp4,.mov,.webm,.mkv" multiple className="hidden" onChange={(e) => { addClips(e.target.files); e.target.value = ""; }} />
                  <button type="button" onClick={() => clipInputRef.current?.click()} className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700">＋ Add clips</button>
                  <span className="text-[11px] font-mono text-gray-400">n = {clips.length}</span>
                </div>
                {clips.length > 0 && (
                  <div className="overflow-x-auto rounded-lg border">
                    <table className="min-w-full text-xs sm:text-sm">
                      <thead className="bg-gray-50 text-[10px] uppercase tracking-wide text-gray-500">
                        <tr><th className="px-2 py-1.5 text-left">#</th><th className="px-2 py-1.5 text-left">Clip</th><th className="px-2 py-1.5 text-right">Order</th></tr>
                      </thead>
                      <tbody className="divide-y">
                        {clips.map((c, i) => (
                          <tr key={c.id} className={i % 2 ? "bg-gray-50/40" : "bg-white"}>
                            <td className="px-2 py-1.5 font-mono text-gray-400">{i + 1}</td>
                            <td className="px-2 py-1.5 max-w-[10rem] truncate" title={c.file.name}>{c.file.name}</td>
                            <td className="px-2 py-1.5">
                              <div className="flex justify-end gap-1">
                                <button onClick={() => moveClip(i, -1)} disabled={i === 0} className="rounded border px-1.5 text-gray-600 disabled:opacity-30">↑</button>
                                <button onClick={() => moveClip(i, 1)} disabled={i === clips.length - 1} className="rounded border px-1.5 text-gray-600 disabled:opacity-30">↓</button>
                                <button onClick={() => removeClip(c.id)} className="rounded border border-red-200 px-1.5 text-red-600">×</button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <div className="rounded-lg border p-3 space-y-2">
                  <div className="text-[11px] uppercase tracking-wide text-gray-400 font-semibold">Unified audio</div>
                  <div className="grid grid-cols-2 gap-2">
                    <button type="button" onClick={() => setAudioMode("upload")} className={`rounded border px-2 py-1.5 text-xs ${audioMode === "upload" ? "bg-gray-800 text-white" : "border-gray-200"}`}>📁 Upload</button>
                    <button type="button" onClick={() => setAudioMode("history")} className={`rounded border px-2 py-1.5 text-xs ${audioMode === "history" ? "bg-gray-800 text-white" : "border-gray-200"}`}>🕘 History</button>
                  </div>
                  {audioMode === "upload" ? (
                    <input ref={audioInputRef} type="file" accept="audio/*,.mp3,.wav,.m4a" className="w-full text-xs" onChange={async (e) => {
                      const f = e.target.files?.[0] || null;
                      setAudioFile(f); setPreview(null);
                      if (f) {
                        const d = await getMediaDuration(f, "audio");
                        if (!autoVoiceDuration) setVoiceDuration(Math.max(1, d - introDelay - outroSec));
                      }
                    }} />
                  ) : (
                    <select value={selectedAudioUrl} onChange={(e) => selectSpeech(e.target.value)} className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-xs">
                      <option value="">∅ Select narration/mix…</option>
                      {speechHistory.map((a) => (
                        <option key={a.audio_url} value={a.audio_url}>{(a.engine_used || "audio")}{a.duration_seconds ? ` (${a.duration_seconds.toFixed(1)}s)` : ""}</option>
                      ))}
                    </select>
                  )}
                </div>
                <p className="text-[11px] text-gray-400">One-pass render. <InfoTip text="Clips are trimmed, zoomed, captioned and muxed in a single encode pass." label="Render pipeline" placement="bottom" /></p>
              </div>
            )}
          </section>

          <section className="rounded-xl border bg-white p-4 sm:p-5 shadow-sm space-y-3">
            <div className="flex items-center justify-between gap-2 border-b pb-2">
              <h2 className="text-base sm:text-lg font-semibold">② Narration script</h2>
              <div className="flex items-center gap-2">
                <InfoTip text="English or Swahili; must match the voiceover for timing." label="Script language" />
                <span className="text-[11px] font-mono text-gray-400">n = {wordCount} words</span>
              </div>
            </div>
            <textarea
              value={scriptText}
              onChange={(e) => { setScriptText(e.target.value); setPreview(null); }}
              rows={6}
              placeholder="Paste the spoken script…"
              className="w-full rounded-lg border border-gray-300 p-3 text-sm leading-relaxed focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-300"
            />
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={useSavedScript} disabled={!selectedAudio?.source_text} className="rounded border px-2 py-1 text-[11px] text-gray-600 hover:bg-gray-50 disabled:opacity-40">🕘 Use saved script</button>
              <button type="button" onClick={() => setScriptText("Karibu Kilimanjaro, leo ni siku nzuri sana. Tunakusalimu kwa upendo mkubwa.")} className="rounded border px-2 py-1 text-[11px] text-gray-600 hover:bg-gray-50">🇹🇿 Sample SW</button>
              <button type="button" onClick={() => setScriptText("Welcome to Kilimanjaro. Today is a beautiful day, and we greet you with great love.")} className="rounded border px-2 py-1 text-[11px] text-gray-600 hover:bg-gray-50">🇬🇧 Sample EN</button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <label className="text-[11px] uppercase tracking-wide text-gray-400 font-semibold">Project topic</label>
              <input value={topic} onChange={(e) => setTopic(e.target.value)} className="min-w-[12rem] flex-1 rounded-md border border-gray-300 px-2 py-1.5 text-xs" placeholder="Kilimanjaro story" />
            </div>
            <p className="text-[11px] text-gray-400">
              Captions use this script. <InfoTip text="No transcription; timings are re-estimated from script and duration." label="Caption source" placement="bottom" />
            </p>
          </section>

          <section className="rounded-xl border bg-white p-4 sm:p-5 shadow-sm space-y-4">
            <div className="flex items-center justify-between gap-2 border-b pb-2">
              <h2 className="text-base sm:text-lg font-semibold">③ Text &amp; lower third</h2>
              <span className="text-[11px] font-mono text-gray-400">
                {textStyle.preset} <InfoTip text="Presets set typography; small controls refine it. The same style is reused on publish assets." label="Shared text style" placement="bottom" />
              </span>
            </div>
            <TextStylePicker value={textStyle} onChange={setTextStyle} />

            <div className="rounded-lg border p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] uppercase tracking-wide text-gray-400 font-semibold">Lower third</span>
                <InfoTip text="Speaker, location and topic labels shown together near the bottom of the video." label="Lower third" />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {(["speaker", "location", "topic"] as const).map((key) => (
                  <label key={key} className="space-y-1">
                    <span className="block text-[10px] uppercase tracking-wide text-gray-400 capitalize">{key}</span>
                    <input
                      value={lowerThird[key]}
                      onChange={(e) => setLowerThird((v) => resolveLowerThird({ ...v, [key]: e.target.value }))}
                      className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-xs"
                      placeholder={key === "speaker" ? "Amina Mwangi" : key === "location" ? "Kilimanjaro" : "Summit story"}
                    />
                  </label>
                ))}
              </div>
              <label className="flex items-center gap-2 text-[11px] text-gray-500">
                On screen
                <input type="range" min={1} max={15} step={1} value={lowerThirdDuration} onChange={(e) => setLowerThirdDuration(parseInt(e.target.value))} className="w-full max-w-[10rem] accent-blue-600" />
                <span className="font-mono tabular-nums">{lowerThirdDuration}s</span>
              </label>
              <p className="text-[10px] text-gray-400">
                Works with or without captions. <InfoTip text="Labels are sanitized and rendered with the selected text style." label="Lower third rendering" placement="bottom" />
              </p>
            </div>
          </section>
        </div>

        {/* Right: safe zone + parameters */}
        <div className="space-y-6 min-w-0">
          <section className="rounded-xl border bg-white p-4 sm:p-5 shadow-sm space-y-4">
            <div className="flex items-center justify-between gap-2 border-b pb-2">
              <h2 className="text-base sm:text-lg font-semibold">④ Safe zones</h2>
              <span className="text-[11px] font-mono text-gray-400"><InfoTip text="Captions avoid platform UI; the selected style controls font, colour, box and placement." label="Safe zones" placement="bottom" /></span>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex items-center justify-center">
                <div
                  className="relative overflow-hidden rounded-lg border-4 border-gray-800 bg-gradient-to-b from-slate-700 to-slate-900 shadow-inner"
                  style={{ width: aspectRatio === "16:9" ? "100%" : (aspectRatio === "9:16" ? "190px" : "230px"), aspectRatio: String(zone.w).concat("/", String(zone.h)) }}
                >
                  {/* bottom platform UI zone */}
                  <div className="absolute inset-x-0 bottom-0 bg-black/45" style={{ height: pct(aspectRatio === "9:16" ? 450 : 220, zone.h) }}>
                    <span className="absolute inset-x-0 top-1 text-center text-[7px] text-white/70">platform caption / description UI</span>
                  </div>
                  {/* right button zone */}
                  <div className="absolute inset-y-0 right-0 bg-black/35" style={{ width: pct(aspectRatio === "9:16" ? 150 : 120, zone.w) }}>
                    <span className="absolute right-0.5 top-1/3 text-[7px] text-white/70 [writing-mode:vertical-rl]">like / share</span>
                  </div>
                  {/* caption safe box */}
                  <div className="absolute rounded border border-dashed border-yellow-300/70" style={{ left: pct(zone.ml, zone.w), right: pct(zone.mr, zone.w), bottom: pct(zone.mv, zone.h), height: "24%", backgroundColor: textStyle.background_opacity > 0 ? `${textStyle.background_color}aa` : "rgba(250, 250, 210, 0.05)" }}>
                    <div className="absolute inset-0 flex items-center justify-center px-1 text-center font-extrabold leading-tight" style={demoStyle}>
                      {demoWords.length ? demoWords.map((w, i) => (
                        <span key={i} style={{ color: i === activeWord % Math.max(1, demoWords.length) ? textStyle.highlight_color : textStyle.base_color }}>
                          {w.toUpperCase()}{i < demoWords.length - 1 ? "\u00a0" : ""}
                        </span>
                      )) : <span style={{ color: textStyle.base_color, opacity: 0.6 }}>YOUR CAPTION</span>}
                    </div>
                  </div>
                  {hasLowerThird(lowerThird) && (
                    <div className="absolute left-1 rounded border border-white/20 px-1 py-0.5 text-[7px] leading-tight" style={{ bottom: pct(Math.min(zone.h - 40, zone.mv + zone.h * 0.28), zone.h), backgroundColor: `${textStyle.background_color}cc` }}>
                      {(["speaker", "location", "topic"] as const).filter((k) => lowerThird[k]).map((k, i) => (
                        <span key={k} style={{ color: i === 0 ? textStyle.highlight_color : textStyle.base_color }}>
                          {lowerThird[k]}{i < 2 ? " · " : ""}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full text-xs sm:text-sm">
                  <thead className="bg-gray-50 text-[10px] uppercase tracking-wide text-gray-500">
                    <tr><th className="px-2 py-1.5 text-left">Symbol</th><th className="px-2 py-1.5 text-left">Meaning</th><th className="px-2 py-1.5 text-right">Value</th></tr>
                  </thead>
                  <tbody className="divide-y font-mono">
                    <tr><td className="px-2 py-1.5 text-blue-600">PlayRes</td><td className="px-2 py-1.5 font-sans">canvas</td><td className="px-2 py-1.5 text-right">{zone.w}×{zone.h}</td></tr>
                    <tr className="bg-gray-50/40"><td className="px-2 py-1.5 text-blue-600">MarginV</td><td className="px-2 py-1.5 font-sans">bottom UI gap</td><td className="px-2 py-1.5 text-right">{zone.mv}px</td></tr>
                    <tr><td className="px-2 py-1.5 text-blue-600">MarginR</td><td className="px-2 py-1.5 font-sans">button gap</td><td className="px-2 py-1.5 text-right">{zone.mr}px</td></tr>
                    <tr className="bg-gray-50/40"><td className="px-2 py-1.5 text-blue-600">Font</td><td className="px-2 py-1.5 font-sans">family · size</td><td className="px-2 py-1.5 text-right font-sans">{textStyle.font_family} · {preview?.style.font_size ?? Math.round(zone.font * textStyle.font_scale / 100)}px</td></tr>
                    <tr><td className="px-2 py-1.5 text-yellow-500">{"{\\c}"}</td><td className="px-2 py-1.5 font-sans">active word</td><td className="px-2 py-1.5 text-right">{preview?.style.highlight ?? textStyle.highlight_color}</td></tr>
                    <tr className="bg-gray-50/40"><td className="px-2 py-1.5 text-yellow-500">base</td><td className="px-2 py-1.5 font-sans">inactive word</td><td className="px-2 py-1.5 text-right">{preview?.style.base ?? textStyle.base_color}</td></tr>
                    <tr><td className="px-2 py-1.5 text-gray-500">Outline</td><td className="px-2 py-1.5 font-sans">stroke</td><td className="px-2 py-1.5 text-right">{preview?.style.outline ?? textStyle.outline_width}px · {textStyle.outline_color}</td></tr>
                    <tr className="bg-gray-50/40"><td className="px-2 py-1.5 text-gray-500">Box</td><td className="px-2 py-1.5 font-sans">background</td><td className="px-2 py-1.5 text-right">{textStyle.background_opacity}%</td></tr>
                    <tr><td className="px-2 py-1.5 text-gray-500">Place</td><td className="px-2 py-1.5 font-sans">align · position</td><td className="px-2 py-1.5 text-right font-sans">{textStyle.alignment} · {textStyle.position}</td></tr>
                    {preview && (
                      <>
                        <tr><td className="px-2 py-1.5 text-gray-500">sample</td><td className="px-2 py-1.5 font-sans">first line</td><td className="px-2 py-1.5 text-right font-sans">{preview.sample_lines[0] || "—"}</td></tr>
                        <tr className="bg-gray-50/40"><td className="px-2 py-1.5 text-gray-500">dur</td><td className="px-2 py-1.5 font-sans">word 1</td><td className="px-2 py-1.5 text-right">{preview.word_timings[0] ? `${preview.word_timings[0].duration.toFixed(3)}s` : "—"}</td></tr>
                        <tr><td className="px-2 py-1.5 text-gray-500">t₀</td><td className="px-2 py-1.5 font-sans">intro delay</td><td className="px-2 py-1.5 text-right">{preview.intro_delay_sec.toFixed(2)}s</td></tr>
                        <tr className="bg-gray-50/40"><td className="px-2 py-1.5 text-gray-500">Tᵥ</td><td className="px-2 py-1.5 font-sans">voice duration</td><td className="px-2 py-1.5 text-right">{preview.voice_duration.toFixed(2)}s</td></tr>
                      </>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </section>

          <section className="rounded-xl border bg-white p-4 sm:p-5 shadow-sm space-y-3">
            <div className="flex items-center justify-between gap-2 border-b pb-2">
              <h2 className="text-base sm:text-lg font-semibold">⑤ Timing parameters</h2>
              <span className="text-[11px] font-mono text-gray-400">Word weights <InfoTip text="Longer words and pauses get more on-screen time." label="Word weights" placement="bottom" /></span>
            </div>
            <div className="overflow-x-auto rounded-lg border">
              <table className="min-w-full text-xs sm:text-sm">
                <thead className="bg-gray-50 text-[10px] uppercase tracking-wide text-gray-500">
                  <tr><th className="px-3 py-2 text-left">Parameter</th><th className="px-3 py-2 text-left">Sym</th><th className="px-3 py-2 text-left min-w-[140px]">Control</th><th className="px-3 py-2 text-right">Value</th></tr>
                </thead>
                <tbody className="divide-y">
                  <tr className="bg-white">
                    <td className="px-3 py-2 font-medium">Intro delay</td><td className="px-3 py-2 font-mono text-gray-400">t₀</td>
                    <td className="px-3 py-2"><input type="range" min={0} max={10} step={0.1} value={introDelay} onChange={(e) => { setIntroDelay(parseFloat(e.target.value)); setPreview(null); }} className="w-full accent-blue-600" /></td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">{introDelay.toFixed(1)}s</td>
                  </tr>
                  <tr className="bg-gray-50/40">
                    <td className="px-3 py-2 font-medium">Outro pad</td><td className="px-3 py-2 font-mono text-gray-400">ε</td>
                    <td className="px-3 py-2"><input type="range" min={0} max={10} step={0.1} value={outroSec} onChange={(e) => { setOutroSec(parseFloat(e.target.value)); setPreview(null); }} className="w-full accent-blue-600" /></td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">{outroSec.toFixed(1)}s</td>
                  </tr>
                  <tr className="bg-white">
                    <td className="px-3 py-2 font-medium">Voice duration</td><td className="px-3 py-2 font-mono text-gray-400">Tᵥ</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <label className="flex items-center gap-1 text-[11px] text-gray-500"><input type="checkbox" checked={autoVoiceDuration} onChange={(e) => { setAutoVoiceDuration(e.target.checked); if (e.target.checked) setVoiceDuration(null); }} /> auto</label>
                        {!autoVoiceDuration && <input type="number" min={0.5} max={600} step={0.5} value={voiceDuration ?? effectiveVoiceDuration} onChange={(e) => { setVoiceDuration(parseFloat(e.target.value)); setPreview(null); }} className="w-24 rounded border border-gray-300 px-2 py-1" />}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">{effectiveVoiceDuration.toFixed(1)}s</td>
                  </tr>
                  <tr className="bg-gray-50/40">
                    <td className="px-3 py-2 font-medium">Aspect</td><td className="px-3 py-2 font-mono text-gray-400">r</td>
                    <td className="px-3 py-2">
                      <PlatformAspectPicker
                        value={aspectRatio}
                        onChange={(ratio) => { setAspectRatio(ratio); setPreview(null); }}
                        compact
                        className="max-w-[15rem]"
                      />
                    </td>
                    <td className="px-3 py-2 text-right font-mono">{aspectRatio}</td>
                  </tr>
                  <tr className="bg-white">
                    <td className="px-3 py-2 font-medium">Language</td><td className="px-3 py-2 font-mono text-gray-400">ℓ</td>
                    <td className="px-3 py-2">
                      <select value={language} onChange={(e) => setLanguage(e.target.value as Language)} className="w-full max-w-[12rem] rounded-md border border-gray-300 px-2 py-1.5 text-xs">
                        <option value="en">English (en)</option>
                        <option value="sw">Swahili (sw)</option>
                      </select>
                    </td>
                    <td className="px-3 py-2 text-right font-mono">{language}</td>
                  </tr>
                  <tr className="bg-gray-50/40">
                    <td className="px-3 py-2 font-medium">Words / chunk</td><td className="px-3 py-2 font-mono text-gray-400">k</td>
                    <td className="px-3 py-2"><input type="range" min={1} max={8} step={1} value={wordsPerChunk} onChange={(e) => { setWordsPerChunk(parseInt(e.target.value)); setPreview(null); }} className="w-full accent-purple-600" /></td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">{wordsPerChunk}</td>
                  </tr>
                  {sourceMode === "fresh" && (
                    <tr className="bg-gray-50/40">
                      <td className="px-3 py-2 font-medium">Trim tail</td><td className="px-3 py-2 font-mono text-gray-400">t</td>
                      <td className="px-3 py-2"><input type="range" min={0} max={5} step={0.1} value={trimEndSec} onChange={(e) => setTrimEndSec(parseFloat(e.target.value))} className="w-full accent-purple-600" /></td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums">{trimEndSec.toFixed(1)}s</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="rounded-lg border p-3 space-y-2">
              <div className="text-[11px] uppercase tracking-wide text-gray-400 font-semibold">Export quality options</div>
              <label className="flex items-start gap-2 text-sm text-gray-700 cursor-pointer select-none">
                <input type="checkbox" checked={loudnorm} onChange={(e) => setLoudnorm(e.target.checked)} className="mt-0.5" />
                <span>
                  <span className="font-medium">Normalize loudness <InfoTip text="Balance audio level for social playback (recommended)." label="Loudness" focusable={false} /></span>
                </span>
              </label>
              <label className="flex items-start gap-2 text-sm text-gray-700 cursor-pointer select-none">
                <input type="checkbox" checked={upscale2k} onChange={(e) => setUpscale2k(e.target.checked)} className="mt-0.5" />
                <span>
                  <span className="font-medium">YouTube 2K upscale <InfoTip text="Higher-resolution export (e.g. 2560×1440 for 16:9). Slower to render." label="Upscaling" focusable={false} /></span>
                </span>
              </label>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={doPreview} className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50">Preview timings <InfoTip text="Shows timing math and sample styling without rendering. Language/topic apply on export." label="Preview" placement="bottom" focusable={false} /></button>
            </div>
            {previewError && <p className="rounded-md bg-red-50 border border-red-100 p-2 text-xs text-red-700">{previewError}</p>}
            {preview && (
              <div className="rounded-lg bg-gray-50 border p-3 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-gray-700">Timing table ({preview.word_count} words)</span>
                  <span className="font-mono text-gray-500">k={preview.chunk_count} chunks</span>
                </div>
                <div className="max-h-40 overflow-auto rounded border bg-white">
                  <table className="min-w-full text-[11px]">
                    <thead className="sticky top-0 bg-gray-100 text-gray-500"><tr><th className="px-2 py-1 text-left">#</th><th className="px-2 py-1 text-left">word</th><th className="px-2 py-1 text-right">start</th><th className="px-2 py-1 text-right">end</th><th className="px-2 py-1 text-right">dur</th><th className="px-2 py-1 text-right">w</th></tr></thead>
                    <tbody className="divide-y">
                      {preview.word_timings.map((t, i) => (
                        <tr key={i} className={i === activeWord % Math.max(1, demoWords.length) ? "bg-yellow-50" : ""}>
                          <td className="px-2 py-1 font-mono text-gray-400">{i + 1}</td>
                          <td className="px-2 py-1 font-medium">{t.word.toUpperCase()}</td>
                          <td className="px-2 py-1 text-right font-mono">{t.start.toFixed(2)}</td>
                          <td className="px-2 py-1 text-right font-mono">{t.end.toFixed(2)}</td>
                          <td className="px-2 py-1 text-right font-mono text-gray-400">{t.duration.toFixed(3)}</td>
                          <td className="px-2 py-1 text-right font-mono text-gray-400">{t.weight}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {preview.sample_lines.length > 0 && (
                  <p className="text-[11px] font-mono text-gray-500">lines: {preview.sample_lines.join(" | ")}</p>
                )}
              </div>
            )}
          </section>
        </div>
      </div>

      {/* Generate & result */}
      <section className="rounded-xl border bg-white p-4 sm:p-5 shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-b pb-2">
          <h2 className="text-base sm:text-lg font-semibold">⑥ Generate &amp; Export</h2>
          <span className="text-[11px] font-mono text-gray-400">
            ready = src:{sourceReady ? "1" : "0"} · text:{(scriptText.trim() || hasLowerThird(lowerThird)) ? "1" : "0"} · Tᵥ:{effectiveVoiceDuration > 0 ? "1" : "0"}
          </span>
        </div>
        {error && <p className="rounded-md bg-red-50 border border-red-100 p-2 text-sm text-red-700">{error}</p>}
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={generate}
            disabled={processing || !sourceReady || (!scriptText.trim() && !hasLowerThird(lowerThird))}
            className="rounded-md bg-purple-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {processing ? "Rendering…" : <>Burn captions <InfoTip text="Renders captions into a downloadable MP4." label="Export captions" placement="bottom" focusable={false} /></>}
          </button>
          <span className="text-[11px] text-gray-400 font-mono">Render <InfoTip text={sourceMode === "fresh" ? "Single pass: trim → zoom → ASS → mux." : "ASS → libass burn → stream-copy audio."} label="Render pipeline" placement="bottom" /></span>
        </div>
        {processing && <p className="text-xs text-amber-600 font-mono">Rendering… <InfoTip text="CPU rendering — longer videos take proportionally more time." label="Rendering" placement="bottom" /></p>}
        {result && (
          <div className="rounded-lg bg-green-50 border border-green-200 p-4 space-y-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <p className="text-sm font-semibold text-green-800">✅ Captioned video ready</p>
              <span className="text-xs font-mono text-green-700 bg-green-100 px-2 py-0.5 rounded">
                {result.word_count ?? wordCount} words · {result.duration_seconds ? result.duration_seconds.toFixed(1) + "s" : "—"} <InfoTip text={`${result.chunk_count ?? Math.ceil(wordCount / wordsPerChunk)} chunks`} label="Caption result" placement="bottom" />
              </span>
            </div>
            <p className="text-[11px] font-mono text-green-700">
              Tᵥ={result.voice_duration_seconds != null ? `${result.voice_duration_seconds.toFixed(1)}s` : "—"} · t₀={result.intro_delay_sec != null ? `${result.intro_delay_sec.toFixed(1)}s` : "—"}
            </p>
            {result.warning && (
              <p className="rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
                ⚠ {result.warning}
              </p>
            )}
            <video controls src={result.video_url} className="w-full rounded-lg bg-black max-h-[520px]" />
            <div className="flex items-center gap-3 flex-wrap">
              <a href={result.video_url} download={`captioned-${result.video_r2_key?.split("/").pop() || "output.mp4"}`} className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700">⬇ Download MP4</a>
              {result.ass_url && <a href={result.ass_url} download className="rounded-md border border-gray-300 px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-100">⬇ Soft subtitles (.ass)</a>}
              <span className="text-[11px] text-gray-500 font-mono truncate max-w-full">{result.video_r2_key || "video output"}</span>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

export default function AnimatedCaptionsPage() {
  return <Suspense fallback={<div className="p-6 text-sm text-gray-500">Loading…</div>}><AnimatedCaptionsPageInner /></Suspense>;
}
