"use client";

import RequireAuth from "@/components/RequireAuth";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import {
  checkHealth,
  DEFAULT_ENGINE,
  Engine,
  ENGINE_LABEL,
  ENGINES_BY_LANGUAGE,
  HealthResponse,
  HISTORY_LIMIT,
  refreshMediaUrl,
  SynthesizeRequest,
  SynthesizeResponse,
  warmEngine,
} from "@/lib/api";
import { addSpeechHistory, loadSpeechHistory, removeSpeechHistory, updateSpeechHistory } from "@/lib/history";
import EngineSelector from "@/components/EngineSelector";
import TextToSpeechForm from "@/components/TextToSpeechForm";
import InfoTip from "@/components/InfoTip";

// Heavy editor subtrees load only when this page opens; the home page stays lean.
const VoiceRecorder = dynamic(() => import("@/components/VoiceRecorder"), {
  ssr: false,
  loading: () => <p className="text-sm text-gray-500">Loading voice recorder…</p>,
});
const AudioPlayer = dynamic(() => import("@/components/AudioPlayer"), {
  ssr: false,
  loading: () => <p className="text-sm text-gray-500">Loading audio player…</p>,
});
const SpeechTimelineSidebar = dynamic(() => import("@/components/SpeechTimelineSidebar"), {
  ssr: false,
  loading: () => <p className="text-sm text-gray-500">Loading timeline…</p>,
});

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
      const loaded = loadSpeechHistory();
      const savedSpeech = loaded.map((s) => ({
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
      // Refresh expired presigned URLs so saved speech stays playable.
      (async () => {
        const refreshed = await Promise.all(
          loaded.map(async (s) => {
            if (!s.audio_r2_key) return null;
            const url = await refreshMediaUrl(s.audio_r2_key);
            return url ? { key: s.audio_r2_key, url } : null;
          })
        );
        setHistory((prev) =>
          prev.map((item) => {
            const r = refreshed.find((x) => x && x.key === item.audio_r2_key);
            return r ? { ...item, audio_url: r.url } : item;
          })
        );
        setResult((cur) => {
          if (!cur?.audio_r2_key) return cur;
          const r = refreshed.find((x) => x && x.key === cur.audio_r2_key);
          return r ? { ...cur, audio_url: r.url } : cur;
        });
      })();
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

  // An empty health list can mean "details hidden", not "no engines enabled".
  const availableEngines = health?.engines?.length ? health.engines : null;

  // Keep the selected engine valid for the current language and enabled backend engines.
  useEffect(() => {
    const allowed = new Set(ENGINES_BY_LANGUAGE[language]);
    const available = availableEngines ? new Set(availableEngines) : null;
    const isValid = (e: Engine) => allowed.has(e) && (!available || available.has(e));
    if (!isValid(engine)) {
      const preferred = DEFAULT_ENGINE[language];
      const fallback = isValid(preferred)
        ? preferred
        : (ENGINES_BY_LANGUAGE[language].find((e: Engine) => isValid(e)) ?? preferred);
      setEngine(fallback);
    }
  }, [language, engine, availableEngines]);

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
      ? "Ready"
      : backendStatus === "checking"
        ? "Checking..."
        : "Waking up";

  const activeAudioUrl = result?.audio_url;

  return (
    <RequireAuth>
    <div className="space-y-6 pb-10">
      <header className="rounded-xl border bg-white p-4 sm:p-6 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">🎙️ Speech</h1>
              <InfoTip text="Turn text into speech in English or Swahili. Add a sample to clone a voice (supported engines), pick a voice, then create and download." label="Text to speech" />
            </div>
            <p className="mt-2 text-sm sm:text-base text-gray-600 max-w-2xl">Text → speech in EN or SW.</p>
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
              <InfoTip text={healthDetail} label="Backend status" placement="bottom" />
            )}
          </div>
        </div>

        <div className="mt-5 grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: "Language", value: language === "en" ? "English" : "Swahili" },
            { label: "Voice", value: ENGINE_LABEL[engine] },
            { label: "Sample", value: voiceKey ? "Added" : "None" },
            { label: "Cleanup", value: denoiseRef ? "On" : "Off" },
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
          {[
            { label: "1 · Sample", tip: "Record or upload 10–15 seconds of clear speech to copy your voice." },
            { label: "2 · Voice", tip: "Pick a preset or a voice that clones your sample." },
            { label: "3 · Create", tip: "Add your text, then create and download the audio." },
          ].map((s) => (
            <div key={s.label} className="flex items-center gap-1.5 rounded-lg border border-blue-100 bg-blue-50/40 px-3 py-2 text-blue-900 font-medium">
              {s.label}
              <InfoTip text={s.tip} label={s.label} placement="bottom" />
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
            <EngineSelector
              engine={engine}
              onChange={setEngine}
              language={language}
              availableEngines={availableEngines}
            />
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
    </RequireAuth>
  );
}