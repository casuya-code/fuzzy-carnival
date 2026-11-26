"use client";

import RequireAuth from "@/components/RequireAuth";



import dynamic from "next/dynamic";

import { Suspense, useEffect, useRef, useState } from "react";

import { useSearchParams } from "next/navigation";

const TextStylePicker = dynamic(() => import("@/components/TextStylePicker"), {
  ssr: false,

  loading: () => <p className="text-sm text-gray-500">Loading text styles…</p>,

});

import { type Language, PackageResult, previewThumbnail, publishPackage, detectBpm } from "@/lib/api";

import { addDeliverable, getDeliverableById, loadSpeechHistory, loadVideoHistory, VideoHistoryItem } from "@/lib/history";

import { getMediaDuration } from "@/lib/media";

import InfoTip from "@/components/InfoTip";

import {

  type LowerThird,

  type TextStyle,

  DEFAULT_TEXT_STYLE,

  EMPTY_LOWER_THIRD,

  loadLowerThird,

  loadTextStyle,

  loadBrandFont,

  resolveLowerThird,

  resolveTextStyle,

  saveLowerThird,

  saveTextStyle,

} from "@/lib/textStyles";



type SourceMode = "history" | "device";

type Accent = "yellow" | "red" | "white";

type Gradient = "left" | "bottom";



function PublishPackagePageInner() {

  const searchParams = useSearchParams();

  const presetId = searchParams.get("preset");

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

  const [frame, setFrame] = useState<"none" | "solid" | "double" | "film">("solid");

  const [shape, setShape] = useState<"none" | "circle" | "rect">("none");

  // Start from server-safe defaults; stored styling is restored after mount.

  const [textStyle, setTextStyle] = useState<TextStyle>({ ...DEFAULT_TEXT_STYLE });

  const [styleReady, setStyleReady] = useState(false);



  const [shortsTitle, setShortsTitle] = useState("MOUNT KILIMANJARO");

  const [lowerThird, setLowerThird] = useState<LowerThird>({ ...EMPTY_LOWER_THIRD });

  const [lowerReady, setLowerReady] = useState(false);

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

  const appliedPresetId = useRef<string | null>(null);

  const resolveStoredStyle = (value: unknown) => {
    const name = loadBrandFont()?.font_name;
    return resolveTextStyle(value, name ? [name] : []);
  };



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



  // Reuse the typography chosen on the captions page.

  useEffect(() => {

    setTextStyle(loadTextStyle());

    setStyleReady(true);

  }, []);



  useEffect(() => {

    setLowerThird(loadLowerThird());

    setLowerReady(true);

  }, []);



  // Apply presets only after the mount/restore effects above have run.
  useEffect(() => {
    if (!presetId || appliedPresetId.current === presetId) return;
    if (!styleReady || !lowerReady) return;

    const item = getDeliverableById(presetId);
    const s = item?.meta?.settings as Record<string, any> | undefined;
    if (!s) return;
    appliedPresetId.current = presetId;

    if (typeof s.hook_words === "string") setHookWords(s.hook_words);

    if (s.accent === "yellow" || s.accent === "red" || s.accent === "white") setAccent(s.accent);

    if (s.gradient === "left" || s.gradient === "bottom") setGradient(s.gradient);

    if (typeof s.border === "boolean") setBorder(s.border);

    if (s.frame === "none" || s.frame === "solid" || s.frame === "double" || s.frame === "film") {
      setFrame(s.frame);
      setBorder(s.frame !== "none");
    }

    if (s.shape === "none" || s.shape === "circle" || s.shape === "rect") setShape(s.shape);

    if (typeof s.shorts_title === "string") setShortsTitle(s.shorts_title);

    if (typeof s.clip_length_sec === "number") setClipLength(Math.max(5, Math.min(180, Math.round(s.clip_length_sec))));

    if (Array.isArray(s.starts)) setStarts(s.starts.filter((n: any) => typeof n === "number").slice(0, 3));

    if (Array.isArray(s.phases)) setPhases(s.phases.filter((p: any) => typeof p === "string").slice(0, 3));

    if (s.text_style) setTextStyle(resolveStoredStyle(s.text_style));

    if (s.lower_third) setLowerThird(resolveLowerThird(s.lower_third));

    if (typeof s.topic === "string") setTopic(s.topic);

    if (s.language === "en" || s.language === "sw") setLanguage(s.language);

  }, [presetId, styleReady, lowerReady]);



  useEffect(() => {

    if (!styleReady) return;

    saveTextStyle(textStyle);

    setThumb(null);

    setResult(null);

  }, [textStyle, styleReady]);



  useEffect(() => {

    if (!lowerReady) return;

    saveLowerThird(lowerThird);

    setResult(null);

  }, [lowerThird, lowerReady]);



  const selectedVideo = videoHistory.find((v) => v.video_url === selectedVideoUrl);

  const knownDuration = sourceMode === "history" ? (selectedVideo?.duration_seconds || 0) : deviceDuration;

  const sourceReady = sourceMode === "history" ? !!selectedVideo?.video_r2_key : !!masterFile;



  const fitShorts = (duration: number) => {

    if (!duration || duration < 15) return;

    // Backend allows 5–180s (MAX_CLIP_LENGTH_SEC); match the slider's 180s cap.

    const len = Math.max(5, Math.min(180, Math.floor(duration / 3), Math.floor(duration)));

    const maxStart = Math.max(0, Math.floor(duration - len));

    setClipLength(len);

    setStarts([0, Math.min(maxStart, Math.round(duration / 3)), Math.min(maxStart, Math.round((2 * duration) / 3))]);

  };



  const fitToBeats = async () => {

    if (sourceMode !== "history" || !selectedVideo?.video_r2_key || !selectedVideo.duration_seconds) return;

    try {

      const r = await detectBpm(selectedVideo.video_r2_key);

      const cycle = r.cycle_sec || 2;

      const dur = selectedVideo.duration_seconds;

      const snap = (x: number) => Math.max(0, Math.min(Math.max(0, dur - 1), Math.round(x / cycle) * cycle));

      const len = Math.max(5, Math.min(180, snap(Math.floor(dur / 3)), Math.floor(dur)));

      const maxStart = Math.max(0, Math.floor(dur - len));

      setClipLength(len);

      setStarts([0, Math.min(maxStart, snap(Math.round(dur / 3))), Math.min(maxStart, snap(Math.round((2 * dur) / 3)))]);

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

      const r = await previewThumbnail({ ...masterPayload(), hook_words: hookWords, accent, gradient, border: frame !== "none", frame, shape, topic, language, text_style: textStyle, font_path: loadBrandFont()?.font_path });

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

        // Match the thumbnail preview exactly: frame/shape imply the border.
        accent, gradient, frame, shape, border: frame !== "none",

        shorts_title: shortsTitle,

        clip_length_sec: clipLength,

        start_times: starts,

        phases,

        topic, language,

        upscale_2k: upscale2k,

        loudnorm,

        text_style: textStyle,

        lower_third: lowerThird,

        font_path: loadBrandFont()?.font_path,

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



  const RECIPES = [

    { name: "Bold", hook: "YOU WON'T BELIEVE", accent: "yellow" as Accent, gradient: "left" as Gradient, frame: "solid" as const, shape: "rect" as const },

    { name: "Clean", hook: "AFRICA'S HIGHEST PEAK", accent: "white" as Accent, gradient: "bottom" as Gradient, frame: "double" as const, shape: "none" as const },

    { name: "Cinematic", hook: "THE UNTOLD STORY", accent: "red" as Accent, gradient: "left" as Gradient, frame: "film" as const, shape: "none" as const },

  ];

  const applyRecipe = (r: typeof RECIPES[number]) => {

    setHookWords(r.hook); setAccent(r.accent); setGradient(r.gradient);

    setFrame(r.frame); setBorder((r.frame as string) !== "none"); setShape(r.shape); setThumb(null);

  };



  const savePreset = () => {

    const name = window.prompt("Preset name", "My publish preset")?.trim().slice(0, 40);

    if (!name) return;

    addDeliverable({

      kind: "preset",

      title: name,

      url: `preset://${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,

      meta: {

        route: "/publish-package",

        settings: {

          hook_words: hookWords,

          accent, gradient, border: frame !== "none", frame, shape,

          shorts_title: shortsTitle,

          clip_length_sec: clipLength,

          starts, phases,

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

            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">📦 Ready to Post</h1>

            <p className="mt-2 flex items-center gap-1.5 text-sm sm:text-base text-gray-600 max-w-3xl">

              Thumbnail and Shorts for your video.

              <InfoTip text="Prepare share-ready files from the finished video." label="About this package" />

            </p>

          </div>

          <button

            type="button"

            onClick={savePreset}

            className="shrink-0 rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"

          >

            Save preset <InfoTip text="Save these publish settings to My Files for reuse." label="Save preset" focusable={false} />

          </button>

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

              <h2 className="text-base sm:text-lg font-semibold">Master video <InfoTip text="Pick a finished video or upload one." label="Master video" /></h2>

            </div>

            <div className="grid grid-cols-2 gap-2">

              <button type="button" onClick={() => { setSourceMode("history"); setThumb(null); setResult(null); }} className={`inline-flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium ${sourceMode === "history" ? "border-blue-500 bg-blue-600 text-white" : "border-gray-200 hover:bg-gray-50"}`}>Saved <InfoTip text="Use a video from an earlier step." label="Saved video" focusable={false} /></button>

              <button type="button" onClick={() => { setSourceMode("device"); setThumb(null); setResult(null); }} className={`inline-flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium ${sourceMode === "device" ? "border-blue-500 bg-blue-600 text-white" : "border-gray-200 hover:bg-gray-50"}`}>Upload <InfoTip text="Upload a video from this device." label="Upload video" focusable={false} /></button>

            </div>

            {sourceMode === "history" ? (

              <div className="space-y-2">

                <select value={selectedVideoUrl} onChange={(e) => chooseHistory(e.target.value)} className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm">

                  <option value="">Select a master video…</option>

                  {videoHistory.map((v) => (

                    <option key={v.video_url} value={v.video_url}>

                      {(v.engine_used || "video")} — {v.video_r2_key?.split("/").pop()?.slice(0, 14)}{v.duration_seconds ? ` (${v.duration_seconds.toFixed(0)}s)` : ""}

                    </option>

                  ))}

                </select>

                {videoHistory.length === 0 && <p className="flex items-center gap-1.5 text-[11px] text-gray-400">No videos yet. <InfoTip text="Create one in Edit Video or Add Captions, or upload." label="No videos" /></p>}

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

              <h2 className="text-base sm:text-lg font-semibold">Thumbnail <InfoTip text="Sharpest frame + readability gradient + 3-word hook." label="Thumbnail" /></h2>

            </div>

            <div className="grid gap-2 sm:grid-cols-2">

              <div className="space-y-2">

                <label className="text-[11px] uppercase tracking-wide text-gray-400 font-semibold">Project name <InfoTip text="Used when naming saved files." label="Project name" /></label>

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

              <label className="text-[11px] uppercase tracking-wide text-gray-400 font-semibold">Recipes <InfoTip text="Quick starting looks for the thumbnail." label="Recipes" /></label>

              <div className="flex flex-wrap gap-1.5">

                {RECIPES.map((r) => (

                  <button key={r.name} type="button" onClick={() => applyRecipe(r)} className="rounded-md border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50">{r.name}</button>

                ))}

              </div>

            </div>

            <div className="space-y-2">

              <label className="text-[11px] uppercase tracking-wide text-gray-400 font-semibold">Hook (3 words) <InfoTip text="The main text drawn on the thumbnail." label="Hook" /></label>

              <input
                value={hookWords}
                onChange={(e) => { setHookWords(e.target.value); setThumb(null); }}
                onBlur={() => setHookWords((v) => v.trim().split(/\s+/).slice(0, 3).join(" "))}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm font-semibold uppercase"
                placeholder="AFRICA'S HIGHEST PEAK"
              />

              <div className="flex flex-wrap gap-1.5">

                <button type="button" onClick={() => setHookWords("AFRICA'S HIGHEST PEAK")} className="rounded border px-2 py-1 text-[11px] hover:bg-gray-50">🇹🇿 Highest peak</button>

                <button type="button" onClick={() => setHookWords("SIRI YA KILIMANJARO")} className="rounded border px-2 py-1 text-[11px] hover:bg-gray-50">🇹🇿 Siri ya Kilimanjaro</button>

                <button type="button" onClick={() => setHookWords("YOU WON'T BELIEVE")} className="rounded border px-2 py-1 text-[11px] hover:bg-gray-50">🇬🇧 Viral hook</button>

              </div>

              <p className="flex items-center gap-1.5 text-[11px] text-gray-400 font-mono">[{hookArray.map((w) => w.toUpperCase()).join(", ")}] <InfoTip text="Only the first 3 words are drawn; the last one is highlighted." label="Hook words" /></p>

            </div>

            <TextStylePicker value={textStyle} onChange={setTextStyle} defaultOpen={false} />

            <p className="flex items-center gap-1.5 text-[10px] text-gray-400">

              Same style as captions. <InfoTip text="The selected preset and colours also style the Shorts banner." label="Shared text style" />

            </p>

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

                <div className="text-[11px] uppercase tracking-wide text-gray-400 font-semibold">Gradient <InfoTip text="Dark overlay so hook text stays readable." label="Gradient" /></div>

                <div className="grid grid-cols-2 gap-1.5">

                  {(["left", "bottom"] as Gradient[]).map((g) => (

                    <button key={g} type="button" onClick={() => { setGradient(g); setThumb(null); }} className={`rounded-md border px-2 py-1.5 text-xs font-medium ${gradient === g ? "border-gray-800 bg-gray-800 text-white" : "border-gray-200"}`}>{g}</button>

                  ))}

                </div>

              </div>

            </div>

            <div className="grid grid-cols-2 gap-3">

              <div className="space-y-1.5">

                <div className="text-[11px] uppercase tracking-wide text-gray-400 font-semibold">Frame <InfoTip text="Border style around the thumbnail." label="Frame" /></div>

                <div className="grid grid-cols-2 gap-1.5">

                  {(["none","solid","double","film"] as const).map((f) => (

                    <button key={f} type="button" onClick={() => { setFrame(f); setBorder(f !== "none"); setThumb(null); }} className={`rounded-md border px-2 py-1.5 text-xs font-medium capitalize ${frame === f ? "border-gray-800 bg-gray-800 text-white" : "border-gray-200"}`}>{f}</button>

                  ))}

                </div>

              </div>

              <div className="space-y-1.5">

                <div className="text-[11px] uppercase tracking-wide text-gray-400 font-semibold">Shape <InfoTip text="Simple accent shape on the thumbnail." label="Shape" /></div>

                <div className="grid grid-cols-3 gap-1.5">

                  {(["none","circle","rect"] as const).map((s) => (

                    <button key={s} type="button" onClick={() => { setShape(s); setThumb(null); }} className={`rounded-md border px-2 py-1.5 text-xs font-medium capitalize ${shape === s ? "border-gray-800 bg-gray-800 text-white" : "border-gray-200"}`}>{s}</button>

                  ))}

                </div>

              </div>

            </div>

            <div className="flex flex-wrap items-center gap-2">

              <button type="button" onClick={doThumbPreview} disabled={thumbLoading || !sourceReady} className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">

                {thumbLoading ? "Designing…" : "🖼️ Preview thumbnail"}

              </button>

              <span className="flex items-center gap-1.5 text-[11px] text-gray-400 font-mono">1280×720 <InfoTip text="Contrast +25%; OpenCV picks the sharpest frame." label="Thumbnail specs" /></span>

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

              <h2 className="text-base sm:text-lg font-semibold">Shorts <InfoTip text="Cuts 9:16 vertical clips at 1080×1920." label="Shorts" /></h2>

            </div>

            <div className="space-y-2">

              <label className="text-[11px] uppercase tracking-wide text-gray-400 font-semibold">Series title <InfoTip text="Banner shown on each Short." label="Series title" /></label>

              <input value={shortsTitle} onChange={(e) => setShortsTitle(e.target.value)} className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm" placeholder="MOUNT KILIMANJARO" />

            </div>

            <div className="rounded-lg border p-3 space-y-2">

              <div className="flex items-center justify-between gap-2">

                <span className="text-[11px] uppercase tracking-wide text-gray-400 font-semibold">Intro labels</span>

                <InfoTip text="Speaker, location and topic shown in the first 5 seconds of each Short." label="Shorts intro labels" />

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

                <p className="flex items-center gap-1.5 text-[11px] text-gray-400">Beat-sync unavailable <InfoTip text="Uploaded device files cannot be beat-synced." label="Beat-sync" /></p>

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

                      <td className="px-2 py-2 text-right">
                        <input
                          type="number"
                          min={0}
                          max={knownDuration > 0 ? Math.max(0, knownDuration - clipLength) : undefined}
                          value={starts[i]}
                          onChange={(e) => {
                            const raw = parseFloat(e.target.value);
                            const maxStart = knownDuration > 0
                              ? Math.max(0, knownDuration - clipLength)
                              : Number.MAX_SAFE_INTEGER;
                            const value = Number.isFinite(raw)
                              ? Math.min(Math.max(raw, 0), maxStart)
                              : 0;
                            setStarts((s) => s.map((x, j) => (j === i ? value : x)));
                          }}
                          className="w-20 rounded border border-gray-200 px-2 py-1 text-right font-mono"
                        />
                      </td>

                    </tr>

                  ))}

                </tbody>

              </table>

            </div>

            <div className="space-y-1.5">

              <div className="text-[11px] uppercase tracking-wide text-gray-400 font-semibold">Timeline <InfoTip text="Start and length of each Short." label="Timeline" /></div>

              <div className="relative h-14 overflow-hidden rounded-lg border bg-gray-50">

                {starts.map((s, i) => (

                  <div key={i} className={`absolute inset-y-1 rounded ${segColor[i]}`} style={{ left: knownDuration ? `${Math.min(95, (s / knownDuration) * 100)}%` : `${i * 33}%`, width: knownDuration ? `${Math.max(6, (clipLength / knownDuration) * 100)}%` : "30%" }}>

                    <span className="absolute inset-0 flex items-center justify-center text-[10px] font-mono font-semibold text-gray-700">S{i + 1}</span>

                  </div>

                ))}

              </div>

              <p className="flex items-center gap-1.5 text-[11px] text-gray-400 font-mono">Hook in first 5s <InfoTip text={<>A hook banner covers the first 5s of each Short. Master: 0s — {knownDuration.toFixed(0)}s.</>} label="Hook banner" /></p>

            </div>

          </section>



          <section className="rounded-xl border bg-white p-4 sm:p-5 shadow-sm space-y-3">

            <div className="flex items-center justify-between gap-2 border-b pb-2">

              <h2 className="text-base sm:text-lg font-semibold">Files <InfoTip text={`${fileCount} files → R2. Lists every file in the package.`} label="Package files" /></h2>

            </div>



            <div className="rounded-lg border p-3 space-y-2">

              <div className="text-[11px] uppercase tracking-wide text-gray-400 font-semibold">Master export options</div>

              <label className="flex items-start gap-2 text-sm text-gray-700 cursor-pointer select-none">

                <input type="checkbox" checked={loudnorm} onChange={(e) => setLoudnorm(e.target.checked)} className="mt-0.5" />

                <span className="font-medium">Normalize loudness <InfoTip text="Balances audio for social playback before packaging (recommended)." label="Normalize loudness" focusable={false} /></span>

              </label>

              <label className="flex items-start gap-2 text-sm text-gray-700 cursor-pointer select-none">

                <input type="checkbox" checked={upscale2k} onChange={(e) => setUpscale2k(e.target.checked)} className="mt-0.5" />

                <span className="font-medium">Master 2K upscale <InfoTip text="Exports the master at a 2K resolution matched to its aspect ratio (e.g. 2560×1440 for 16:9). Slower to process." label="2K upscale" focusable={false} /></span>

              </label>

            </div>

            <div className="overflow-x-auto rounded-lg border">

              <table className="min-w-full text-xs sm:text-sm">

                <thead className="bg-gray-50 text-[10px] uppercase tracking-wide text-gray-500">

                  <tr><th className="px-2 py-2 text-left">#</th><th className="px-2 py-2 text-left">File</th><th className="px-2 py-2 text-left hidden sm:table-cell">Formula</th><th className="px-2 py-2 text-right">Spec</th></tr>

                </thead>

                <tbody className="divide-y">

                  <tr className="bg-white"><td className="px-2 py-2 font-mono text-gray-400">1</td><td className="px-2 py-2 font-medium">master_video.mp4</td><td className="px-2 py-2 font-mono text-gray-500 hidden sm:table-cell">Master export <InfoTip text="Optional 2K upscale and loudness normalization." label="Master export" /></td><td className="px-2 py-2 text-right font-mono">{upscale2k ? "2K (aspect-matched)" : "Source resolution"}</td></tr>

                  <tr className="bg-gray-50/40"><td className="px-2 py-2 font-mono text-gray-400">2</td><td className="px-2 py-2 font-medium">youtube_thumbnail.jpg</td><td className="px-2 py-2 font-mono text-gray-500 hidden sm:table-cell">Sharpest frame + hook <InfoTip text="Sharpest frame + readability gradient + hook." label="Thumbnail formula" /></td><td className="px-2 py-2 text-right font-mono">1280×720</td></tr>

                  {[0, 1, 2].map((i) => (

                    <tr key={i} className={i % 2 ? "bg-gray-50/40" : "bg-white"}>

                      <td className="px-2 py-2 font-mono text-gray-400">{i + 3}</td>

                      <td className="px-2 py-2 font-medium">short_part_{i + 1}_9x16.mp4</td>

                      <td className="px-2 py-2 font-mono text-gray-500 hidden sm:table-cell">Crop at start <InfoTip text={`From ${starts[i]}s for ${clipLength}s.`} label="Crop" /></td>

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

          <h2 className="text-base sm:text-lg font-semibold">Ready <InfoTip text={`Master, hook and Shorts are set. Master: ${sourceReady ? "set" : "missing"} · Hook: ${hookWords.trim() ? "set" : "missing"} · Shorts: 3.`} label="Package readiness" /></h2>

        </div>

        {error && <p className="rounded-md bg-red-50 border border-red-100 p-2 text-sm text-red-700">{error}</p>}

        <div className="flex flex-wrap items-center gap-3">

          <button onClick={publish} disabled={processing || !sourceReady || !hookWords.trim()} className="inline-flex items-center gap-1.5 rounded-md bg-purple-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed">

            {processing ? <>Packaging… <InfoTip text={`Rendering ${fileCount} files with FFmpeg + Pillow.`} label="Packaging" focusable={false} /></> : "🚀 Publish Package"}

          </button>

          <InfoTip text="Thumbnail → 3 center-crop Shorts → upload all to R2." label="Packaging steps" />

        </div>

        {processing && <p className="flex items-center gap-1.5 text-xs text-amber-600 font-mono">Rendering… <InfoTip text="Runs on Railway CPU (ultrafast); long masters take proportionally longer." label="Rendering" /></p>}



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

                <div className="text-[11px] uppercase tracking-wide text-gray-500 font-semibold">Master film</div>

                <video controls src={result.master_url} className="w-full rounded-lg bg-black max-h-64" />

                <p className="text-[11px] font-mono text-gray-500">

                  {result.master?.width && result.master?.height

                    ? `${result.master.width}×${result.master.height}`

                    : upscale2k ? "2K (aspect-matched)" : "Source resolution"}

                </p>

                <a href={result.master_url} download={result.master?.r2_key?.split("/").pop() || "master_video.mp4"} className="inline-block rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700">⬇ Master MP4</a>

              </div>

            </div>



            <div className="space-y-2">

              <div className="text-[11px] uppercase tracking-wide text-gray-500 font-semibold">Shorts (9:16)</div>

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

export default function PublishPackagePage() {
  return <RequireAuth><Suspense fallback={<div className="p-6 text-sm text-gray-500">Loading…</div>}><PublishPackagePageInner /></Suspense></RequireAuth>;
}
