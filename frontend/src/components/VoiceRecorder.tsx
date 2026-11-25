"use client";

import { useEffect, useRef, useState } from "react";
import InfoTip from "@/components/InfoTip";
import { analyzeAudio, ReferenceAnalysis, requestUploadUrl, uploadToR2 } from "@/lib/api";
import { getMediaDuration } from "@/lib/media";

interface Props {
  onUploaded: (key: string | null) => void;
  voiceKey: string | null;
  denoiseRef: boolean;
  onDenoiseChange: (v: boolean) => void;
}

const MAX_SECONDS = 15;
const MIN_SECONDS = 3;

const AUDIO_EXTENSIONS: Record<string, string> = {
  "audio/webm": "webm",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/wave": "wav",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/aac": "aac",
  "audio/ogg": "ogg",
  "audio/flac": "flac",
};

/** Derive the saved sample's extension from its real type (falling back to the filename). */
function extensionForType(type: string, name?: string): string {
  const key = (type || "").split(";")[0].trim().toLowerCase();
  if (AUDIO_EXTENSIONS[key]) return AUDIO_EXTENSIONS[key];
  const fromName = name?.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase();
  return fromName || "webm";
}

function qualityLabel(score: number) {
  if (score >= 80) return { text: "Good", cls: "text-green-700 bg-green-50 border-green-200" };
  if (score >= 55) return { text: "Fair", cls: "text-amber-700 bg-amber-50 border-amber-200" };
  return { text: "Needs improvement", cls: "text-red-700 bg-red-50 border-red-200" };
}

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
  const tooShortRef = useRef(false);

  const [mode, setMode] = useState<"record" | "upload">("record");
  const [recording, setRecording] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [done, setDone] = useState(false);
  const [level, setLevel] = useState(0);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewExt, setPreviewExt] = useState("webm");
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
        setLevel(Math.min(1, rms * 4));
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
      const mimeCandidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
      const mimeType = mimeCandidates.find((m) => {
        try { return typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(m); } catch { return false; }
      }) || "";
      const mr = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      chunksRef.current = [];
      mr.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      mr.onstop = () => {
        void (async () => {
          stopLevelMeter();
          stream.getTracks().forEach((t) => t.stop());
          if (!mountedRef.current) return;
          if (tooShortRef.current) {
            // Recording was rejected for being too short — discard the chunks.
            chunksRef.current = [];
            return;
          }
          const blob = new Blob(chunksRef.current, { type: mr.mimeType || "audio/webm" });
          const ext = extensionForType(blob.type);
          setPreviewExt(ext);
          setPreview(URL.createObjectURL(blob));
          await handleUpload(blob, `reference.${ext}`, blob.type || "audio/webm");
        })();
      };
      mr.start();
      mediaRecorderRef.current = mr;
      tooShortRef.current = false;
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
      stopLevelMeter();
      try { streamRef.current?.getTracks().forEach((t) => t.stop()); } catch {}
      streamRef.current = null;
      if (mountedRef.current) setError(e?.message || "Microphone access was denied. Please allow microphone access and try again.");
    }
  };

  const stop = () => {
    if (mediaRecorderRef.current && recording) {
      if (secondsRef.current < MIN_SECONDS) {
        tooShortRef.current = true;
        setError(`Recording is only ${secondsRef.current}s. Please record at least ${MIN_SECONDS}s of clear speech.`);
      }
      mediaRecorderRef.current.stop();
      setRecording(false);
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
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
      const { upload_url, key } = await requestUploadUrl(filename, contentType, blob.size);
      await uploadToR2(upload_url, blob, contentType);
      if (!mountedRef.current) return;
      onUploaded(key);
      setDone(true);
      try {
        const a = await analyzeAudio(key);
        if (mountedRef.current) setAnalysis(a);
      } catch {
        // analysis is advisory only
      }
    } catch (e: any) {
      if (mountedRef.current) {
        setError(e?.message || "Upload failed. Please try again.");
        setDone(false);
      }
    } finally {
      if (mountedRef.current) setUploading(false);
    }
  };

  const handleFile = async (file: File) => {
    setError(null);
    setAnalysis(null);
    try {
      const duration = await getMediaDuration(file, "audio");
      if (duration > 0 && duration < MIN_SECONDS) {
        setError(`That file is only ${duration.toFixed(1)}s. Please upload at least ${MIN_SECONDS}s of clear speech.`);
        return;
      }
    } catch {
      // Duration detection is advisory; allow upload to proceed.
    }
    const ct = file.type || "audio/wav";
    const ext = extensionForType(ct, file.name);
    setPreviewExt(ext);
    setPreview(URL.createObjectURL(file));
    await handleUpload(file, file.name || `reference.${ext}`, ct);
  };

  const clearVoice = () => {
    onUploaded(null);
    setDone(false);
    setSeconds(0);
    secondsRef.current = 0;
    setError(null);
    setAnalysis(null);
    setPreview(null);
    setPreviewExt("webm");
    tooShortRef.current = false;
  };

  const progress = Math.min((seconds / MAX_SECONDS) * 100, 100);
  const hasVoice = !!voiceKey;
  const statusLabel = recording ? "Recording" : uploading ? "Uploading" : hasVoice && done ? "Ready" : hasVoice ? "Saved" : "Not added";

  return (
    <section className="rounded-xl border bg-white p-4 sm:p-5 shadow-sm space-y-4">
      <div className="flex items-start justify-between gap-3 border-b pb-3">
        <div>
          <h3 className="text-base sm:text-lg font-semibold">Step 1: Voice sample</h3>
          <p className="mt-1 text-sm text-gray-600">
            <InfoTip
              text="Optional for some voices; 10–15s of clear speech lets the app copy that voice."
              label="Voice sample details"
            />
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${
            statusLabel === "Ready" || statusLabel === "Saved"
              ? "bg-green-50 text-green-700"
              : statusLabel === "Recording"
                ? "bg-red-50 text-red-700"
                : statusLabel === "Uploading"
                  ? "bg-amber-50 text-amber-700"
                  : "bg-gray-100 text-gray-600"
          }`}>
            {statusLabel}
          </span>
          {hasVoice && !recording && !uploading && (
            <button onClick={clearVoice} className="text-xs sm:text-sm text-gray-600 underline hover:text-gray-800">
              Remove
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-sm">
        <div className="rounded-lg border bg-gray-50/60 px-3 py-2">
          <div className="text-xs uppercase tracking-wide text-gray-500">Voice sample</div>
          <div className={`mt-0.5 font-medium ${hasVoice ? "text-green-700" : "text-gray-800"}`}>{hasVoice ? "Added" : "Not added"}</div>
        </div>
        <div className="rounded-lg border bg-gray-50/60 px-3 py-2">
          <div className="text-xs uppercase tracking-wide text-gray-500">Noise cleanup</div>
          <div className="mt-0.5 font-medium text-gray-800">{denoiseRef ? "On" : "Off"}</div>
        </div>
        <div className="rounded-lg border bg-gray-50/60 px-3 py-2">
          <div className="text-xs uppercase tracking-wide text-gray-500">
            Time <InfoTip text="Aim for 10–15 seconds." label="Recording time" />
          </div>
          <div className="mt-0.5 font-medium text-gray-800">{seconds}s</div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => setMode("record")}
          className={`rounded-lg border px-3 py-2.5 text-sm font-medium transition ${mode === "record" ? "border-gray-800 bg-gray-800 text-white" : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50"}`}
        >
          Record{" "}
          <InfoTip text="Record a sample with your microphone." label="Record details" focusable={false} />
        </button>
        <button
          type="button"
          onClick={() => setMode("upload")}
          className={`rounded-lg border px-3 py-2.5 text-sm font-medium transition ${mode === "upload" ? "border-gray-800 bg-gray-800 text-white" : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50"}`}
        >
          Upload{" "}
          <InfoTip text="Upload a saved voice sample file." label="Upload details" focusable={false} />
        </button>
      </div>

      {mode === "record" ? (
        <div className="space-y-3 rounded-lg border bg-gray-50/40 p-3 sm:p-4">
          <div className="flex flex-wrap items-center gap-3">
            {!recording ? (
              <button
                onClick={start}
                disabled={uploading}
                className="rounded-lg bg-red-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-red-700 disabled:opacity-50"
              >
                {uploading ? "Uploading..." : done ? "Record again" : "Start recording"}
              </button>
            ) : (
              <button
                onClick={stop}
                className="rounded-lg bg-gray-800 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-gray-900"
              >
                Stop recording ({seconds}s)
              </button>
            )}
            {recording && (
              <div className="flex-1 min-w-[180px]">
                <div className="h-2.5 w-full overflow-hidden rounded-full bg-gray-200">
                  <div
                    className={`h-full rounded-full transition-all duration-1000 ease-linear ${seconds >= MAX_SECONDS - 3 ? "bg-red-500" : "bg-blue-500"}`}
                    style={{ width: `${progress}%` }}
                  />
                </div>
                <div className="mt-1 flex justify-between text-xs text-gray-500">
                  <span>{seconds}s</span><span>Auto-stops at {MAX_SECONDS}s</span>
                </div>
              </div>
            )}
          </div>

          {recording && (
            <div className="space-y-1">
              <div className="flex items-center justify-between text-xs text-gray-600">
                <span>
                  Mic level <InfoTip text="Speak clearly in a quiet room, at a steady distance from the microphone." label="Microphone tips" />
                </span>
                <span>{level < 0.05 ? "Very quiet" : level > 0.85 ? "Too loud" : "Good"}</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-gray-200">
                <div className="h-full rounded-full bg-green-500 transition-all duration-75" style={{ width: `${Math.round(level * 100)}%` }} />
              </div>
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
            className="w-full rounded-lg border-2 border-dashed border-gray-300 p-5 text-sm text-gray-700 transition hover:border-blue-400 hover:bg-blue-50 disabled:opacity-50"
          >
            {uploading ? (
              "Uploading..."
            ) : (
              <>
                Choose audio file{" "}
                <InfoTip text="WAV, MP3, WebM, M4A and more." label="Audio file formats" focusable={false} />
              </>
            )}
          </button>
          <p className="text-xs text-gray-500">
            Consistent voice <InfoTip text="Use the same voice sample for a series to keep the voice consistent." label="Voice consistency" />
          </p>
        </div>
      )}

      {error && <p className="rounded-md bg-red-50 border border-red-100 p-3 text-sm text-red-700">{error}</p>}

      {analysis && (
        <div className={`rounded-lg border p-3 space-y-2 ${qualityLabel(analysis.quality_score).cls}`}>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-sm">Sound quality: {qualityLabel(analysis.quality_score).text}</span>
            <span className="text-xs opacity-80">({Math.round(analysis.quality_score)}/100)</span>
            {analysis.clipping && (
              <span className="text-xs font-medium">
                Clipping <InfoTip text="The audio may be too loud." label="Clipping details" />
              </span>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 text-[11px] font-mono">
            {[
              { label: "duration", value: analysis.duration, digits: 2, suffix: "s" },
              { label: "rms", value: analysis.rms, digits: 3 },
              { label: "peak", value: analysis.peak, digits: 3 },
              { label: "crest_db", value: analysis.crest_db, digits: 1 },
              { label: "snr_db", value: analysis.snr_db, digits: 1 },
              { label: "sample_rate", value: analysis.sample_rate, digits: 0, suffix: " Hz" },
            ].map((m) => (
              <div key={m.label} className="rounded border bg-white/60 px-2 py-1">
                <div className="opacity-70">{m.label}</div>
                <div className="font-semibold">{m.value == null ? "—" : `${Number(m.value).toFixed(m.digits)}${m.suffix || ""}`}</div>
              </div>
            ))}
          </div>
          {analysis.hints.length > 0 && (
            <ul className="list-disc pl-5 space-y-1 text-sm">
              {analysis.hints.slice(0, 3).map((hint, i) => <li key={i}>{hint}</li>)}
            </ul>
          )}
        </div>
      )}

      {previewUrl && (
        <div className="rounded-lg border bg-gray-50 p-3 space-y-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <p className="text-sm font-medium text-gray-700">
              Listen to your sample{" "}
              <InfoTip text="If it sounds unclear, too quiet, or noisy, record again for better results." label="Sample preview tips" />
            </p>
            <a href={previewUrl} download={`voice-sample.${previewExt}`} className="text-sm text-blue-600 hover:underline shrink-0">
              Save sample
            </a>
          </div>
          <audio controls src={previewUrl} className="w-full h-9" />
        </div>
      )}

      <label className="flex items-start gap-2.5 text-sm text-gray-700 cursor-pointer select-none rounded-lg border p-3 bg-white">
        <input type="checkbox" className="mt-0.5" checked={denoiseRef} onChange={(e) => onDenoiseChange(e.target.checked)} />
        <span>
          <span className="font-medium">
            Noise cleanup <InfoTip text="Recommended for clearer, more stable voice copying." label="Noise cleanup details" focusable={false} />
          </span>
        </span>
      </label>

      <div className="text-sm space-y-2">
        {recording && (
          <p className="text-blue-700 font-medium">
            Recording… <InfoTip text="Use the energy you want in the final audio." label="Recording tip" />
          </p>
        )}
        {uploading && <p className="text-amber-700 font-medium">Uploading your voice sample...</p>}
        {done && hasVoice && !recording && !uploading && (
          <div className="space-y-1 rounded-lg bg-green-50 border border-green-100 p-3">
            <p className="text-green-700 font-medium">
              Sample ready <InfoTip text="Use this sample with voices that copy your voice. For best results, use a clear 10–15 second recording." label="Sample details" />
            </p>
          </div>
        )}
        {!recording && !uploading && !done && (
          <div className="text-gray-700 space-y-1.5">
            <p className="font-medium">
              Voice sample tips{" "}
              <InfoTip
                text={`10–15s of natural speech (at least ${MIN_SECONDS}s); one voice in a quiet place; steady mic distance, no background music/noise; speak with the energy/style you want copied.`}
                label="Voice sample tips"
              />
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
