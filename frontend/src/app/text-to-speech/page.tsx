"use client";

import { useEffect, useState } from "react";
import {
  checkHealth,
  DEFAULT_ENGINE,
  Engine,
  ENGINE_LABEL,
  HealthResponse,
  HISTORY_LIMIT,
  SynthesizeRequest,
  SynthesizeResponse,
  warmEngine,
} from "@/lib/api";
import { addSpeechHistory, loadSpeechHistory, removeSpeechHistory, updateSpeechHistory } from "@/lib/history";
import VoiceRecorder from "@/components/VoiceRecorder";
import EngineSelector from "@/components/EngineSelector";
import TextToSpeechForm from "@/components/TextToSpeechForm";
import AudioPlayer from "@/components/AudioPlayer";
import SpeechTimelineSidebar from "@/components/SpeechTimelineSidebar";

export default function TextToSpeechPage() {
  const [language, setLanguage] = useState<"en" | "sw">("en");
  const [engine, setEngine] = useState<Engine>(DEFAULT_ENGINE.en);
  const [voiceKey, setVoiceKey] = useState<string | null>(null);
  const [denoiseRef, setDenoiseRef] = useState(true);
  const [result, setResult] = useState<SynthesizeResponse | null>(null);
  const [history, setHistory] = useState<SynthesizeResponse[]>([]);
  const [backendStatus, setBackendStatus] = useState<"checking" | "awake" | "sleeping">("checking");
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [lastReq, setLastReq] = useState<SynthesizeRequest | null>(null);

  // Restore saved preferences and recent speech history after mount
  useEffect(() => {
    const saved = localStorage.getItem("voiceKey");
    if (saved) setVoiceKey(saved);
    const dn = localStorage.getItem("denoiseRef");
    if (dn !== null) setDenoiseRef(dn === "true");

    try {
      const savedSpeech = loadSpeechHistory().map((s) => ({
        audio_r2_key: s.audio_r2_key,
        audio_url: s.audio_url,
        engine_used: s.engine_used || "unknown",
        duration_seconds: s.duration_seconds,
        source_text: s.source_text || s.request?.text,
        timeline: s.timeline,
        timeline_source: s.timeline_source,
        warning: s.warning,
        request: s.request,
      })) as SynthesizeResponse[];
      if (savedSpeech.length > 0) {
        setHistory(savedSpeech.slice(0, HISTORY_LIMIT));
        setResult((cur) => cur ?? savedSpeech[0]);
        setLastReq((cur) => cur ?? savedSpeech[0].request ?? null);
      }
    } catch {}
  }, []);

  const handleVoice = (key: string | null) => {
    setVoiceKey(key);
    if (key) localStorage.setItem("voiceKey", key);
    else localStorage.removeItem("voiceKey");
  };

  const handleDenoiseChange = (v: boolean) => {
    setDenoiseRef(v);
    try { localStorage.setItem("denoiseRef", String(v)); } catch {}
  };

  const handleResult = (res: SynthesizeResponse, req: SynthesizeRequest) => {
    const enriched: SynthesizeResponse = {
      ...res,
      source_text: res.source_text || req.text,
      request: req,
    };
    setResult(enriched);
    setLastReq(req);
    setHistory((prev) => [enriched, ...prev.filter((r) => r.audio_url !== enriched.audio_url)].slice(0, HISTORY_LIMIT));
    // Persist to shared speech history for other pages and timeline reuse
    addSpeechHistory({
      audio_r2_key: enriched.audio_r2_key,
      audio_url: enriched.audio_url,
      engine_used: enriched.engine_used,
      duration_seconds: enriched.duration_seconds,
      source_text: enriched.source_text || undefined,
      timeline: enriched.timeline || undefined,
      timeline_source: enriched.timeline_source || undefined,
      warning: enriched.warning,
      language: req.language,
      topic: req.topic,
      request: req,
    });
  };

  const handleRemoveHistory = (url: string) => {
    setHistory((prev) => {
      const next = prev.filter((r) => r.audio_url !== url);
      setResult((cur) => (cur?.audio_url === url ? (next[0] ?? null) : cur));
      return next;
    });
    removeSpeechHistory(url);
  };

  const handleSelectHistory = (item: SynthesizeResponse) => {
    setResult(item);
    // Prefer the exact request that produced this take; only rebuild for legacy entries.
    setLastReq(
      item.request ??
        (item.source_text
          ? {
              text: item.source_text,
              language,
              engine,
              voice_r2_key: voiceKey,
              denoise_ref: denoiseRef,
            }
          : null)
    );
  };

  useEffect(() => {
    let cancelled = false;
    const ping = async () => {
      setBackendStatus("checking");
      try {
        const data = await checkHealth();
        if (!cancelled) {
          setHealth(data);
          setBackendStatus(data.awake ? "awake" : "sleeping");
        }
      } catch {
        if (!cancelled) {
          setHealth(null);
          setBackendStatus("sleeping");
        }
      }
    };
    ping();
    const id = setInterval(ping, 60000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  // Pre-warm selected engine in background for faster first generation
  useEffect(() => {
    warmEngine(engine);
  }, [engine]);

  const healthDetail = health
    ? [
        health.status ? `status: ${health.status}` : null,
        `awake: ${health.awake}`,
        health.loaded_models?.length
          ? `loaded_models: ${health.loaded_models.join(", ")}`
          : "loaded_models: none",
        health.engines?.length ? `engines: ${health.engines.join(", ")}` : "engines: none",
        health.capabilities
          ? [
              health.capabilities.azure_configured ? "Azure ready" : "Azure not configured",
              health.capabilities.elevenlabs_configured ? "ElevenLabs ready" : "ElevenLabs not configured",
              health.capabilities.elevenlabs_cloning ? "cloning on" : "cloning off",
            ].join(" · ")
          : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : "No health response yet";

  const statusText =
    backendStatus === "awake"
      ? "Online and ready"
      : backendStatus === "checking"
        ? "Checking connection..."
        : "Waking up (first request may take a little longer)";

  const activeAudioUrl = result?.audio_url;

  return (
    <div className="space-y-6 pb-10">
      <header className="rounded-xl border bg-white p-4 sm:p-6 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">🎙️ Text to Speech</h1>
            <p className="mt-2 text-sm sm:text-base text-gray-600 max-w-2xl">
              Turn your text into natural speech in English or Swahili. Add a voice sample to copy a voice (for supported options),
              choose a voice, then create and download your audio.
            </p>
          </div>
          <div className="flex items-center gap-2 rounded-full border bg-white px-3 py-1.5 text-xs sm:text-sm shadow-sm self-start" title={healthDetail}>
            <span
              className={`inline-block h-2.5 w-2.5 rounded-full ${
                backendStatus === "awake"
                  ? "bg-green-500"
                  : backendStatus === "sleeping"
                    ? "bg-amber-500 animate-pulse"
                    : "bg-gray-400 animate-pulse"
              }`}
            />
            <span
              className={
                backendStatus === "awake"
                  ? "text-green-700 font-medium"
                  : backendStatus === "sleeping"
                    ? "text-amber-700"
                    : "text-gray-500"
              }
            >
              {statusText}
            </span>
            {health && (
              <span className="hidden sm:inline text-[10px] text-gray-500">
                awake: {String(health.awake)}{health.loaded_models?.length ? ` · ${health.loaded_models.length} models` : ""}{health.engines?.length ? ` · ${health.engines.length} engines` : ""}
              </span>
            )}
          </div>
        </div>

        <div className="mt-5 grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: "Language", value: language === "en" ? "English" : "Swahili" },
            { label: "Voice", value: ENGINE_LABEL[engine] },
            { label: "Your voice sample", value: voiceKey ? "Added" : "Not added" },
            { label: "Noise cleanup", value: denoiseRef ? "On" : "Off" },
          ].map((m) => (
            <div key={m.label} className="rounded-lg border bg-gray-50/60 px-3 py-2.5 min-w-0">
              <div className="text-[11px] uppercase tracking-wide text-gray-500">{m.label}</div>
              <div className="mt-0.5 text-sm font-semibold text-gray-800 truncate" title={String(m.value)}>
                {m.value}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-2 text-sm">
          {["1. Add voice sample (optional)", "2. Choose a voice", "3. Create speech"].map((s) => (
            <div key={s} className="rounded-lg border border-blue-100 bg-blue-50/40 px-3 py-2 text-blue-900 font-medium">
              {s}
            </div>
          ))}
        </div>
      </header>

      <div className="grid gap-6 2xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="grid gap-6 xl:grid-cols-2 min-w-0">
          <div className="space-y-6 min-w-0">
            <VoiceRecorder
              onUploaded={handleVoice}
              voiceKey={voiceKey}
              denoiseRef={denoiseRef}
              onDenoiseChange={handleDenoiseChange}
            />
            <EngineSelector engine={engine} onChange={setEngine} language={language} />
          </div>
          <div className="space-y-6 min-w-0">
            <TextToSpeechForm
              language={language}
              setLanguage={setLanguage}
              engine={engine}
              setEngine={setEngine}
              voiceKey={voiceKey}
              denoiseRef={denoiseRef}
              onResult={handleResult}
            />
            <AudioPlayer
              result={result}
              history={history}
              onSelect={handleSelectHistory}
              lastReq={lastReq}
              onRegenerated={handleResult}
              onRemove={handleRemoveHistory}
            />
          </div>
        </div>

        <div className="min-w-0 2xl:sticky 2xl:top-4 self-start">
          <SpeechTimelineSidebar
            audioUrl={result?.audio_url}
            audioKey={result?.audio_r2_key}
            sourceText={result?.source_text || lastReq?.text || null}
            initialTimeline={result?.timeline || null}
            initialSource={result?.timeline_source || null}
            onTimelineChange={(timeline, source) => {
              setResult((cur) => (cur ? { ...cur, timeline, timeline_source: source } : cur));
              setHistory((prev) =>
                prev.map((h) =>
                  h.audio_url === activeAudioUrl ? { ...h, timeline, timeline_source: source } : h
                )
              );
              if (activeAudioUrl) {
                updateSpeechHistory(activeAudioUrl, { timeline, timeline_source: source });
              }
            }}
          />
        </div>
      </div>
    </div>
  );
}