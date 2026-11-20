"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { buildSpeechTimeline, TimelineSegment } from "@/lib/api";

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

function renumber(segments: Omit<TimelineSegment, "id">[]): TimelineSegment[] {
  return segments.map((s, i) => ({
    ...s,
    id: i + 1,
    start: Number(s.start.toFixed(3)),
    end: Number(s.end.toFixed(3)),
    duration: Number(Math.max(0, s.end - s.start).toFixed(3)),
  }));
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
  }, [audioUrl, audioKey, sourceText, initialTimeline, initialSource]);

  useEffect(() => {
    return () => {
      if (stopTimerRef.current) clearTimeout(stopTimerRef.current);
    };
  }, []);

  const totalDuration = useMemo(() => {
    if (!segments.length) return 0;
    return segments[segments.length - 1].end;
  }, [segments]);

  const stopPlayback = () => {
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
    if (stopTimerRef.current) clearTimeout(stopTimerRef.current);
    const a = audioRef.current;
    a.src = audioUrl;
    a.currentTime = Math.max(0, seg.start);
    const playPromise = a.play();
    setPlayingId(seg.id);
    const ms = Math.max(150, (seg.end - seg.start) * 1000);
    stopTimerRef.current = setTimeout(() => {
      a.pause();
      setPlayingId(null);
      stopTimerRef.current = null;
    }, ms);
    if (playPromise && typeof playPromise.catch === "function") {
      playPromise.catch(() => {
        setPlayingId(null);
      });
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
      const next = (res.timeline || []) as TimelineSegment[];
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
      start: a.start,
      end: b.end,
      duration: b.end - a.start,
      text: `${a.text} ${b.text}`.replace(/\s+/g, " ").trim(),
    };
    const before = segments.slice(0, idx).map(({ id: _id, ...rest }) => rest);
    const after = segments.slice(idx + 2).map(({ id: _id, ...rest }) => rest);
    updateSegments(renumber([...before, merged, ...after]), "edited");
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
    const midTime = clamp(seg.start + (seg.end - seg.start) * ratio, seg.start + 0.05, seg.end - 0.05);
    const left = { start: seg.start, end: midTime, duration: midTime - seg.start, text: leftText };
    const right = { start: midTime, end: seg.end, duration: seg.end - midTime, text: rightText };
    const before = segments.slice(0, idx).map(({ id: _id, ...rest }) => rest);
    const after = segments.slice(idx + 1).map(({ id: _id, ...rest }) => rest);
    updateSegments(renumber([...before, left, right, ...after]), "edited");
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
    URL.revokeObjectURL(url);
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
      ? "Provider timestamps"
      : source === "alignment"
        ? "Forced alignment"
        : source === "estimated"
          ? "Estimated (script + duration)"
          : source === "edited"
            ? "Edited"
            : source
              ? source
              : "Not generated";

  return (
    <aside className="rounded-xl border bg-white shadow-sm overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-gray-50"
      >
        <div>
          <div className="text-sm font-semibold text-gray-900">Speech-to-Timeline</div>
          <div className="text-xs text-gray-500">Phrase timings for captions, clip planning, and prompts</div>
        </div>
        <span className="text-xs font-medium text-gray-500">{open ? "Hide" : "Show"}</span>
      </button>

      {open && (
        <div className="border-t p-4 space-y-3">
          <audio ref={audioRef} className="hidden" onEnded={() => setPlayingId(null)} />

          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="rounded-full bg-gray-100 px-2.5 py-1 text-gray-700 font-medium">Source: {sourceLabel}</span>
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
              <label className="block text-[11px] font-medium text-gray-600">Script text (what the speech says)</label>
              <textarea
                value={scriptText}
                onChange={(e) => setScriptText(e.target.value)}
                rows={4}
                placeholder="Paste or edit the spoken script here if missing or different..."
                className="w-full rounded-md border border-gray-300 p-2 text-xs text-gray-700 focus:outline-none focus:ring-1 focus:ring-blue-300"
              />
              <p className="text-[11px] text-gray-500">Auto-filled for newly generated speech. If unavailable, paste the script to generate an aligned/estimated timeline.</p>
            </div>
          )}

          {warning && <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md p-2">{warning}</p>}
          {error && <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-md p-2">{error}</p>}
          {!audioUrl && <p className="text-xs text-gray-500">Create or select speech to build a timeline.</p>}
          {audioUrl && !(scriptText || sourceText || "").trim() && (
            <p className="text-xs text-gray-500">This item doesn&apos;t have saved script text. Paste what the speech says above to generate a timeline, or generate a new speech (script auto-fills for new results).</p>
          )}

          {segments.length > 0 ? (
            <div className="space-y-2 max-h-[70vh] overflow-auto pr-1">
              {segments.map((seg, idx) => (
                <div key={`${seg.id}-${seg.start}-${idx}`} className="rounded-lg border p-2.5 space-y-2">
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
            <div className="text-xs text-gray-500 border border-dashed rounded-lg p-3">
              No timeline yet. Generate speech (ElevenLabs can include timestamps) or click <span className="font-medium">Generate timeline</span> for a best-effort fallback from audio duration and script.
            </div>
          )}
        </div>
      )}
    </aside>
  );
}
