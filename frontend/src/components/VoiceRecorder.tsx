"use client";

import { useEffect, useRef, useState } from "react";
import { analyzeAudio, ReferenceAnalysis, requestUploadUrl, uploadToR2 } from "@/lib/api";

interface Props {
  onUploaded: (key: string | null) => void;
  voiceKey: string | null;
  denoiseRef: boolean;
  onDenoiseChange: (v: boolean) => void;
}

const MAX_SECONDS = 15;
const MIN_SECONDS = 3; // backend enforces 3s; UI encourages 5-15s

export default function VoiceRecorder({ onUploaded, voiceKey, denoiseRef, onDenoiseChange }: Props) {
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const secondsRef = useRef(0);
  const previewUrlRef = useRef<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const mountedRef = useRef(true);

  const [mode, setMode] = useState<"record" | "upload">("record");
  const [recording, setRecording] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [done, setDone] = useState(false);
  const [level, setLevel] = useState(0); // 0..1 mic level
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<ReferenceAnalysis | null>(null);

  const setPreview = (url: string | null) => {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = url;
    setPreviewUrl(url);
  };

  const stopLevelMeter = () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    try { audioCtxRef.current?.close(); } catch {}
    audioCtxRef.current = null;
    analyserRef.current = null;
    if (mountedRef.current) setLevel(0);
  };

  const startLevelMeter = (stream: MediaStream) => {
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      audioCtxRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      analyserRef.current = analyser;
      const data = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        if (!analyserRef.current) return;
        analyserRef.current.getByteTimeDomainData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) {
          const v = (data[i] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / data.length);
        setLevel(Math.min(1, rms * 4)); // scale up for visibility
        rafRef.current = requestAnimationFrame(tick);
      };
      tick();
    } catch {
      // analyser not critical
    }
  };

  const start = async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!mountedRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      streamRef.current = stream;
      startLevelMeter(stream);
      const mr = new MediaRecorder(stream, { mimeType: "audio/webm" });
      chunksRef.current = [];
      mr.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      mr.onstop = async () => {
        stopLevelMeter();
        stream.getTracks().forEach((t) => t.stop());
        if (!mountedRef.current) return;
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        setPreview(URL.createObjectURL(blob));
        await handleUpload(blob, "reference.webm", "audio/webm");
      };
      mr.start();
      mediaRecorderRef.current = mr;
      setAnalysis(null);
      setRecording(true);
      setDone(false);
      secondsRef.current = 0;
      setSeconds(0);
      timerRef.current = setInterval(() => {
        secondsRef.current += 1;
        setSeconds(secondsRef.current);
      }, 1000);
    } catch (e: any) {
      if (mountedRef.current) setError(e?.message || "Microphone access denied");
    }
  };

  const stop = () => {
    if (mediaRecorderRef.current && recording) {
      mediaRecorderRef.current.stop();
      setRecording(false);
      if (timerRef.current) clearInterval(timerRef.current);
    }
  };

  useEffect(() => {
    if (recording && seconds >= MAX_SECONDS) stop();
  }, [seconds, recording]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (timerRef.current) clearInterval(timerRef.current);
      const mr = mediaRecorderRef.current;
      if (mr) {
        mr.onstop = null;
        if (mr.state !== "inactive") {
          try { mr.stop(); } catch {}
        }
      }
      streamRef.current?.getTracks().forEach((t) => t.stop());
      stopLevelMeter();
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleUpload = async (blob: Blob, filename: string, contentType: string) => {
    setUploading(true);
    setError(null);
    setAnalysis(null);
    try {
      const { upload_url, key } = await requestUploadUrl(filename, contentType);
      await uploadToR2(upload_url, blob, contentType);
      if (!mountedRef.current) return;
      onUploaded(key);
      setDone(true);
      // Non-blocking quality analysis (backend converts non-WAV first).
      try {
        const a = await analyzeAudio(key);
        if (mountedRef.current) setAnalysis(a);
      } catch {
        // analysis is advisory only
      }
    } catch (e: any) {
      if (mountedRef.current) {
        setError(e?.message || "Upload failed");
        setDone(false);
      }
    } finally {
      if (mountedRef.current) setUploading(false);
    }
  };

  const handleFile = async (file: File) => {
    setError(null);
    setPreview(URL.createObjectURL(file));
    const ct = file.type || "audio/wav";
    await handleUpload(file, file.name || "reference.wav", ct);
  };

  const clearVoice = () => {
    onUploaded(null);
    setDone(false);
    setSeconds(0);
    secondsRef.current = 0;
    setError(null);
    setAnalysis(null);
    setPreview(null);
  };

  const progress = Math.min((seconds / MAX_SECONDS) * 100, 100);

  const status = recording ? "recording" : uploading ? "uploading" : done && voiceKey ? "ready" : "idle";

  return (
    <section className="rounded-xl border bg-white p-4 sm:p-5 shadow-sm space-y-4">
      <div className="flex items-center justify-between gap-2 border-b pb-2">
        <h3 className="text-base sm:text-lg font-semibold">① Reference Voice</h3>
        <div className="flex items-center gap-2">
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-mono ${
            status === "ready" ? "bg-green-50 text-green-700" : status === "recording" ? "bg-red-50 text-red-700" : status === "uploading" ? "bg-amber-50 text-amber-700" : "bg-gray-100 text-gray-600"
          }`}>state = {status}</span>
          {voiceKey && !recording && !uploading && (
            <button onClick={clearVoice} className="text-xs text-gray-500 underline hover:text-gray-700">
              Clear
            </button>
          )}
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <table className="min-w-full text-xs sm:text-sm">
          <thead className="bg-gray-50 text-[11px] uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-3 py-2 text-left font-semibold">Param</th>
              <th className="px-3 py-2 text-left font-semibold">Value</th>
              <th className="px-3 py-2 text-left font-semibold hidden sm:table-cell">Note</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            <tr className="bg-white">
              <td className="px-3 py-2 font-mono text-gray-500">ref</td>
              <td className="px-3 py-2 font-mono tabular-nums">{voiceKey ? "1 (set)" : "0 (none)"}</td>
              <td className="px-3 py-2 text-gray-500 hidden sm:table-cell">Saved reference key used for cloning</td>
            </tr>
            <tr className="bg-gray-50/40">
              <td className="px-3 py-2 font-mono text-gray-500">denoise</td>
              <td className="px-3 py-2 font-mono">{denoiseRef ? "1 (on)" : "0 (off)"}</td>
              <td className="px-3 py-2 text-gray-500 hidden sm:table-cell">Background noise reduction</td>
            </tr>
            <tr className="bg-white">
              <td className="px-3 py-2 font-mono text-gray-500">t</td>
              <td className="px-3 py-2 font-mono tabular-nums">{seconds}s / {MAX_SECONDS}s</td>
              <td className="px-3 py-2 text-gray-500 hidden sm:table-cell">Recommended 10–15s (min {MIN_SECONDS}s)</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => setMode("record")}
          className={`rounded-md border px-3 py-2 text-xs sm:text-sm font-medium transition ${mode === "record" ? "border-gray-800 bg-gray-800 text-white" : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"}`}
        >
          🎤 Record
        </button>
        <button
          type="button"
          onClick={() => setMode("upload")}
          className={`rounded-md border px-3 py-2 text-xs sm:text-sm font-medium transition ${mode === "upload" ? "border-gray-800 bg-gray-800 text-white" : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"}`}
        >
          📁 Upload file
        </button>
      </div>

      {mode === "record" ? (
        <div className="space-y-3 rounded-lg border bg-gray-50/40 p-3">
          <div className="flex flex-wrap items-center gap-3">
            {!recording ? (
              <button
                onClick={start}
                disabled={uploading}
                className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-red-700 disabled:opacity-50"
              >
                {uploading ? "Uploading…" : done ? "Re-record" : "Start Recording"}
              </button>
            ) : (
              <button
                onClick={stop}
                className="rounded-md bg-gray-800 px-4 py-2 text-sm font-medium text-white transition hover:bg-gray-900"
              >
                ⏹ Stop ({seconds}s)
              </button>
            )}
            {recording && (
              <div className="flex-1 min-w-[160px]">
                <div className="h-2 w-full overflow-hidden rounded-full bg-gray-200">
                  <div
                    className={`h-full rounded-full transition-all duration-1000 ease-linear ${seconds >= MAX_SECONDS - 3 ? "bg-red-500" : "bg-blue-500"}`}
                    style={{ width: `${progress}%` }}
                  />
                </div>
                <div className="mt-1 flex justify-between text-[10px] font-mono text-gray-400">
                  <span>{seconds}s</span><span>{MAX_SECONDS}s</span>
                </div>
              </div>
            )}
          </div>
          {recording && (
            <div className="grid grid-cols-[auto_1fr_auto] items-center gap-2 text-[11px] font-mono text-gray-500">
              <span>level</span>
              <div className="h-1.5 overflow-hidden rounded-full bg-gray-200">
                <div className="h-full rounded-full bg-green-500 transition-all duration-75" style={{ width: `${Math.round(level * 100)}%` }} />
              </div>
              <span className="tabular-nums">{level < 0.05 ? "low" : level > 0.85 ? "high" : "ok"} ({Math.round(level * 100)}%)</span>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="audio/*,.wav,.mp3,.webm,.m4a,.ogg"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
              e.target.value = "";
            }}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="w-full rounded-lg border-2 border-dashed border-gray-300 p-4 text-sm text-gray-600 transition hover:border-blue-400 hover:bg-blue-50 disabled:opacity-50"
          >
            {uploading ? "Uploading…" : "Click to choose an audio file (WAV, MP3, WebM, M4A…)"}
          </button>
          <p className="text-[11px] text-gray-400 font-mono">tip: upload one master clip and reuse for series consistency.</p>
        </div>
      )}

      {error && <p className="rounded-md bg-red-50 border border-red-100 p-2 text-sm text-red-700">{error}</p>}

      {analysis && (
        <div className="rounded-md border border-blue-100 bg-blue-50 p-2.5 text-[11px] text-blue-900 space-y-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono">
            <span className="font-semibold">quality {Math.round(analysis.quality_score)}/100</span>
            <span>rms {analysis.rms.toFixed(3)}</span>
            <span>peak {analysis.peak.toFixed(3)}</span>
            <span>crest {analysis.crest_db.toFixed(1)} dB</span>
            {analysis.snr_db != null && <span>snr {analysis.snr_db.toFixed(1)} dB</span>}
            {analysis.clipping && <span className="text-red-700 font-semibold">⚠ clipping</span>}
          </div>
          {analysis.hints.length > 0 && (
            <ul className="list-disc pl-4 space-y-0.5">
              {analysis.hints.slice(0, 3).map((hint, i) => <li key={i}>{hint}</li>)}
            </ul>
          )}
        </div>
      )}

      {previewUrl && (
        <div className="rounded-lg border bg-gray-50 p-3 space-y-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <p className="text-[11px] font-medium text-gray-600">Preview reference (energy / clarity / pacing)</p>
            <a href={previewUrl} download="reference-voice.webm" className="text-[11px] text-blue-600 hover:underline shrink-0">
              ⬇ Save reference
            </a>
          </div>
          <audio controls src={previewUrl} className="w-full h-8" />
          <p className="text-[10px] text-gray-400">Reuse the same master reference to keep identity consistent.</p>
        </div>
      )}

      <label className="flex items-center gap-2 text-xs sm:text-sm text-gray-700 cursor-pointer select-none rounded-lg border p-2.5 bg-white">
        <input type="checkbox" checked={denoiseRef} onChange={(e) => onDenoiseChange(e.target.checked)} />
        <span>
          <span className="font-medium">Remove background noise</span> <span className="text-gray-400 font-mono">(denoise = {denoiseRef ? "1" : "0"})</span> — recommended for clean, stable cloning
        </span>
      </label>

      <div className="text-xs space-y-2">
        {recording && (
          <p className="text-blue-600 font-medium">🎤 Recording… match the energy you want in output. Auto-stops at {MAX_SECONDS}s.</p>
        )}
        {uploading && <p className="text-amber-600 font-medium">⬆️ Uploading reference clip…</p>}
        {done && voiceKey && (
          <div className="space-y-1 rounded-md bg-green-50 border border-green-100 p-2">
            <p className="text-green-700 font-medium">
              ✅ Voice ready — {denoiseRef ? "noise-reduced, " : ""}trimmed & normalized for stable cloning.
            </p>
            <p className="text-amber-700">If energy/clarity/pacing is off, re-record — a weak sample becomes a weak series.</p>
          </div>
        )}
        {!recording && !uploading && !done && (
          <div className="text-gray-600 space-y-1">
            <p>10–15s recommended (min {MIN_SECONDS}s) of natural sentences. Clone copies rhythm, emotion, artifacts — not just timbre.</p>
            <ul className="list-disc pl-4 space-y-0.5 text-gray-500">
              <li><strong>One voice only</strong>, clear audio, minimal noise.</li>
              <li>Quiet room, steady mic distance, no background music/hum.</li>
              <li>Match target energy (upbeat teacher, calm narrator, etc.).</li>
              <li>Use one “master” reference for the series.</li>
              <li>Don’t whisper unless you want a whispery clone.</li>
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}