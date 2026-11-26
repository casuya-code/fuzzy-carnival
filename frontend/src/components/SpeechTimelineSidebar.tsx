"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { buildSpeechTimeline, TimelineSegment } from "@/lib/api";
import InfoTip from "@/components/InfoTip";

interface Props {
  audioUrl?: string | null;
  audioKey?: string | null;
  sourceText?: string | null;
  initialTimeline?: TimelineSegment[] | null;
  initialSource?: string | null;
  onTimelineChange?: (timeline: TimelineSegment[], source: string) => void;
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function fmtTime(sec: number) {
  const s = Math.max(0, sec);
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  return `${m}:${r.toFixed(2).padStart(5, "0")}`;
}

/** Keep existing segment IDs stable; new segments get an ID above the current max. */
function withStableIds(segments: Array<Omit<TimelineSegment, "id"> & { id?: number }>): TimelineSegment[] {
  const used = new Set<number>();
  let nextId = segments.reduce((max, s) => Math.max(max, Number(s.id) || 0), 0) + 1;
  return segments.map((s) => {
    const candidate = Number(s.id);
    const id = Number.isInteger(candidate) && candidate > 0 && !used.has(candidate)
      ? candidate
      : nextId++;
    used.add(id);
    return {
      ...s,
      id,
      start: Number(s.start.toFixed(3)),
      end: Number(s.end.toFixed(3)),
      duration: Number(Math.max(0, s.end - s.start).toFixed(3)),
    };
  });
}

function promptIdea(text: string) {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return "";
  return `Cinematic visual for: ${clean}`;
}

export default function SpeechTimelineSidebar({
  audioUrl,
  audioKey,
  sourceText,
  initialTimeline,
  initialSource,
  onTimelineChange,
}: Props) {
  const [open, setOpen] = useState(true);
  const [segments, setSegments] = useState<TimelineSegment[]>(initialTimeline || []);
  const [source, setSource] = useState<string>(initialSource || (initialTimeline?.length ? "provided" : ""));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [playingId, setPlayingId] = useState<number | null>(null);
  const [prompts, setPrompts] = useState<Record<number, string>>({});
  const [scriptText, setScriptText] = useState<string>(sourceText || "");
  const [showScript, setShowScript] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const stopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadedSrcRef = useRef<string | null>(null);
  const pendingSeekRef = useRef<(() => void) | null>(null);

  // Only reset local state for a different take. initialTimeline/sourceText are
  // starting values — editing a timeline updates them via onTimelineChange, and
  // re-running this effect would wipe prompts, script, playback and messages.
  useEffect(() => {
    const segs = initialTimeline || [];
    setSegments(segs);
    setSource(initialSource || (segs.length ? "provided" : ""));
    setPrompts({});
    setError(null);
    setWarning(null);
    setPlayingId(null);
    const derived = sourceText || (segs.length ? segs.map((s) => s.text).join(" ") : "");
    setScriptText(derived);
    setShowScript(!derived);
  }, [audioUrl, audioKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    return () => {
      if (stopTimerRef.current) clearTimeout(stopTimerRef.current);
      pendingSeekRef.current?.();
    };
  }, []);

  const totalDuration = useMemo(() => {
    if (!segments.length) return 0;
    return segments[segments.length - 1].end;
  }, [segments]);

  const stopPlayback = () => {
    pendingSeekRef.current?.();
    if (stopTimerRef.current) clearTimeout(stopTimerRef.current);
    stopTimerRef.current = null;
    audioRef.current?.pause();
    setPlayingId(null);
  };

  const playSegment = (seg: TimelineSegment) => {
    if (!audioUrl || !audioRef.current) return;
    if (playingId === seg.id) {
      stopPlayback();
      return;
    }
    stopPlayback();
    const a = audioRef.current;
    const startAt = () => {
      try { a.currentTime = Math.max(0, seg.start); } catch { /* metadata not seekable */ }
      const playPromise = a.play();
      setPlayingId(seg.id);
      const ms = Math.max(150, (seg.end - seg.start) * 1000);
      if (stopTimerRef.current) clearTimeout(stopTimerRef.current);
      stopTimerRef.current = setTimeout(() => {
        a.pause();
        setPlayingId((cur) => (cur === seg.id ? null : cur));
        stopTimerRef.current = null;
      }, ms);
      if (playPromise && typeof playPromise.catch === "function") {
        playPromise.catch(() => {
          if (stopTimerRef.current) clearTimeout(stopTimerRef.current);
          stopTimerRef.current = null;
          setPlayingId((cur) => (cur === seg.id ? null : cur));
        });
      }
    };

    // Seeking before loadedmetadata is a no-op in most browsers. Wait for the
    // event on a fresh src, or seek immediately when this src is already loaded.
    if (loadedSrcRef.current === audioUrl && a.readyState >= 1) {
      startAt();
      return;
    }
    const cleanup = () => {
      a.removeEventListener("loadedmetadata", onLoaded);
      a.removeEventListener("error", onError);
      if (pendingSeekRef.current === cleanup) pendingSeekRef.current = null;
    };
    const onLoaded = () => {
      cleanup();
      loadedSrcRef.current = audioUrl;
      startAt();
    };
    const onError = () => {
      cleanup();
      setPlayingId(null);
    };
    pendingSeekRef.current = cleanup;
    a.addEventListener("loadedmetadata", onLoaded);
    a.addEventListener("error", onError);
    if (a.src !== audioUrl) {
      a.src = audioUrl;
      a.load();
    }
  };

  const updateSegments = (next: TimelineSegment[], nextSource?: string) => {
    setSegments(next);
    if (nextSource) setSource(nextSource);
    onTimelineChange?.(next, nextSource || source || "edited");
  };

  const generate = async () => {
    const text = (scriptText || sourceText || "").trim();
    if (!audioKey || !text || loading) return;
    setLoading(true);
    setError(null);
    setWarning(null);
    try {
      const res = await buildSpeechTimeline({
        audio_r2_key: audioKey,
        text,
        prefer_alignment: true,
      });
      const next = withStableIds((res.timeline || []) as TimelineSegment[]);
      setSegments(next);
      setSource(res.timeline_source || "estimated");
      setWarning(res.warning || null);
      if (!next.length) setError("No timeline segments were generated for this audio.");
      if (!scriptText.trim() && next.length) {
        setScriptText(next.map((s) => s.text).join(" "));
      }
      onTimelineChange?.(next, res.timeline_source || "estimated");
    } catch (e: any) {
      setError(e?.message || "Could not generate timeline.");
    } finally {
      setLoading(false);
    }
  };

  const mergeWithNext = (idx: number) => {
    if (idx < 0 || idx >= segments.length - 1) return;
    const a = segments[idx];
    const b = segments[idx + 1];
    const merged = {
      ...a,
      end: b.end,
      duration: b.end - a.start,
      text: `${a.text} ${b.text}`.replace(/\s+/g, " ").trim(),
    };
    // Keep the first segment's id so prompts and references stay attached.
    updateSegments(withStableIds([...segments.slice(0, idx), merged, ...segments.slice(idx + 2)]), "edited");
  };

  const splitSegment = (idx: number) => {
    const seg = segments[idx];
    if (!seg) return;
    const words = seg.text.trim().split(/\s+/).filter(Boolean);
    if (words.length < 2) return;
    const mid = Math.ceil(words.length / 2);
    const leftText = words.slice(0, mid).join(" ");
    const rightText = words.slice(mid).join(" ");
    const ratio = leftText.length / Math.max(1, seg.text.length);
    const pad = Math.min(0.05, (seg.end - seg.start) / 4);
    const midTime = clamp(seg.start + (seg.end - seg.start) * ratio, seg.start + pad, seg.end - pad);
    const left = { ...seg, end: midTime, duration: midTime - seg.start, text: leftText };
    // The new right half gets a fresh id above the current maximum.
    const right = { start: midTime, end: seg.end, duration: seg.end - midTime, text: rightText };
    updateSegments(withStableIds([...segments.slice(0, idx), left, right, ...segments.slice(idx + 1)]), "edited");
  };

  const copyJson = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(segments, null, 2));
    } catch {}
  };

  const exportJson = () => {
    const blob = new Blob([JSON.stringify({ source: source || "unknown", total_duration: totalDuration, segments }, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "speech-timeline.json";
    a.click();
    // Give the browser a task cycle to start the download before releasing the URL.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  const fillPromptIdeas = () => {
    const next: Record<number, string> = {};
    for (const s of segments) next[s.id] = prompts[s.id]?.trim() ? prompts[s.id] : promptIdea(s.text);
    setPrompts(next);
  };

  const copyPrompts = async () => {
    const lines = segments.map((s) => {
      const p = prompts[s.id]?.trim() || promptIdea(s.text);
      return `[${s.start.toFixed(2)}-${s.end.toFixed(2)}s] ${s.text}\nPrompt: ${p}`;
    });
    try {
      await navigator.clipboard.writeText(lines.join("\n\n"));
    } catch {}
  };

  const sourceLabel =
    source === "provider"
      ? "Provider"
      : source === "alignment"
        ? "Aligned"
        : source === "estimated"
          ? "Estimated"
          : source === "edited"
            ? "Edited"
            : source
              ? source
              : "None";

  return (
    <aside className="rounded-xl border bg-white shadow-sm overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-gray-50"
      >
        <div className="flex items-center gap-1.5">
          <div className="text-sm font-semibold text-gray-900">Speech timeline</div>
          <InfoTip text="Phrase timings for captions, clip planning, and prompts." label="Speech timeline" focusable={false} />
        </div>
        <span className="text-xs font-medium text-gray-500">{open ? "Hide" : "Show"}</span>
      </button>

      {open && (
        <div className="border-t p-4 space-y-3">
          <audio
            ref={audioRef}
            className="hidden"
            onLoadedMetadata={() => { loadedSrcRef.current = audioUrl || null; }}
            onEnded={() => setPlayingId(null)}
          />

          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-2.5 py-1 text-gray-700 font-medium">{sourceLabel} <InfoTip text="How the timings were produced." label="Timing source" /></span>
            <span className="rounded-full bg-gray-100 px-2.5 py-1 text-gray-700">{segments.length} segments</span>
            {totalDuration > 0 && <span className="rounded-full bg-gray-100 px-2.5 py-1 text-gray-700">{totalDuration.toFixed(2)}s</span>}
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={generate}
              disabled={loading || !audioKey || !(scriptText || sourceText || "").trim()}
              className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              title={!audioKey ? "Needs audio" : !(scriptText || sourceText || "").trim() ? "Needs script text for timeline fallback/alignment" : "Generate or refresh timeline"}
            >
              {loading ? "Generating..." : segments.length ? "Refresh timeline" : "Generate timeline"}
            </button>
            <button type="button" onClick={fillPromptIdeas} disabled={!segments.length} className="rounded-md border px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50">Prompt ideas</button>
            <button type="button" onClick={copyJson} disabled={!segments.length} className="rounded-md border px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50">Copy JSON</button>
            <button type="button" onClick={exportJson} disabled={!segments.length} className="rounded-md border px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50">Export</button>
            <button type="button" onClick={copyPrompts} disabled={!segments.length} className="rounded-md border px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50">Copy prompts</button>
            <button type="button" onClick={() => setShowScript((v) => !v)} className="rounded-md border px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50">
              {showScript ? "Hide script" : "Script text"}
            </button>
          </div>

          {showScript && (
            <div className="space-y-1">
              <div className="flex items-center gap-1.5">
                <label className="block text-[11px] font-medium text-gray-600">Script text</label>
                <InfoTip text="The words that were spoken. Paste or edit the script if missing or different. Auto-filled for new speech; otherwise paste it to build an aligned/estimated timeline." label="Script text" />
              </div>
              <textarea
                value={scriptText}
                onChange={(e) => setScriptText(e.target.value)}
                rows={4}
                placeholder="Paste the script…"
                className="w-full rounded-md border border-gray-300 p-2 text-xs text-gray-700 focus:outline-none focus:ring-1 focus:ring-blue-300"
              />
            </div>
          )}

          {warning && <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md p-2">{warning}</p>}
          {error && <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-md p-2">{error}</p>}
          {!audioUrl && <p className="text-xs text-gray-500">Create or select speech to build a timeline.</p>}
          {audioUrl && !(scriptText || sourceText || "").trim() && (
            <p className="flex items-center gap-1.5 text-xs text-gray-500">Add script text to build a timeline. <InfoTip text="New speech results auto-fill the script." label="Script needed" /></p>
          )}

          {segments.length > 0 ? (
            <div className="space-y-2 max-h-[70vh] overflow-auto pr-1">
              {segments.map((seg, idx) => (
                <div key={seg.id} className="rounded-lg border p-2.5 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => playSegment(seg)}
                      disabled={!audioUrl}
                      className={`rounded-md px-2 py-1 text-[11px] font-mono border ${playingId === seg.id ? "bg-blue-600 text-white border-blue-600" : "bg-gray-50 text-gray-700 hover:bg-gray-100"} disabled:opacity-50`}
                      title="Play this segment"
                    >
                      {fmtTime(seg.start)} – {fmtTime(seg.end)}
                    </button>
                    <span className="text-[11px] text-gray-500 font-mono">{seg.duration.toFixed(2)}s</span>
                  </div>
                  <p className="text-sm text-gray-800 leading-snug">{seg.text}</p>
                  <input
                    type="text"
                    value={prompts[seg.id] ?? ""}
                    onChange={(e) => setPrompts((p) => ({ ...p, [seg.id]: e.target.value }))}
                    placeholder={promptIdea(seg.text)}
                    className="w-full rounded-md border border-gray-200 px-2 py-1.5 text-xs text-gray-700 focus:outline-none focus:ring-1 focus:ring-blue-300"
                  />
                  <div className="flex flex-wrap gap-1.5">
                    <button type="button" onClick={() => splitSegment(idx)} className="rounded border px-2 py-0.5 text-[11px] text-gray-700 hover:bg-gray-50">Split</button>
                    <button type="button" onClick={() => mergeWithNext(idx)} disabled={idx === segments.length - 1} className="rounded border px-2 py-0.5 text-[11px] text-gray-700 hover:bg-gray-50 disabled:opacity-40">Merge ↓</button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex items-center gap-1.5 text-xs text-gray-500 border border-dashed rounded-lg p-3">
              No timeline yet. <InfoTip text="Generate speech with timestamps (ElevenLabs can include them), or use the best-effort fallback from audio duration and script." label="No timeline" />
            </div>
          )}
        </div>
      )}
    </aside>
  );
}
