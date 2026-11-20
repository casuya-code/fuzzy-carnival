"use client";

import { useEffect, useState } from "react";
import { Engine, SynthesizeResponse, SynthesizeRequest, checkHealth, warmEngine } from "@/lib/api";
import { addSpeechHistory, removeSpeechHistory } from "@/lib/history";
import VoiceRecorder from "@/components/VoiceRecorder";
import EngineSelector from "@/components/EngineSelector";
import TextToSpeechForm from "@/components/TextToSpeechForm";
import AudioPlayer from "@/components/AudioPlayer";

export default function TextToSpeechPage() {
  const [language, setLanguage] = useState<"en" | "sw">("en");
  const [engine, setEngine] = useState<Engine>("kyutai");
  const [voiceKey, setVoiceKey] = useState<string | null>(null);
  const [denoiseRef, setDenoiseRef] = useState(true);
  const [result, setResult] = useState<SynthesizeResponse | null>(null);
  const [history, setHistory] = useState<SynthesizeResponse[]>([]);
  const [backendStatus, setBackendStatus] = useState<"checking" | "awake" | "sleeping">("checking");
  const [loadedModels, setLoadedModels] = useState<string[]>([]);
  const [lastReq, setLastReq] = useState<SynthesizeRequest | null>(null);

  // Restore saved preferences after mount
  useEffect(() => {
    const saved = localStorage.getItem("voiceKey");
    if (saved) setVoiceKey(saved);
    const dn = localStorage.getItem("denoiseRef");
    if (dn !== null) setDenoiseRef(dn === "true");
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
    setResult(res);
    setLastReq(req);
    setHistory((prev) => [res, ...prev.filter((r) => r.audio_url !== res.audio_url)].slice(0, 8));
    // Persist to shared speech history for the Speech-and-Background page
    addSpeechHistory({
      audio_r2_key: res.audio_r2_key,
      audio_url: res.audio_url,
      engine_used: res.engine_used,
      duration_seconds: res.duration_seconds,
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

  useEffect(() => {
    let cancelled = false;
    const ping = async () => {
      setBackendStatus("checking");
      try {
        const h = await checkHealth();
        if (!cancelled) {
          setBackendStatus("awake");
          setLoadedModels(h.loaded_models || []);
        }
      } catch {
        if (!cancelled) setBackendStatus("sleeping");
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

  const engineLabel: Record<Engine, string> = {
    kyutai: "FLUENT (EN)",
    afrispeech: "AFRICA (EN)",
    msingi: "Msingi-AI Sauti (SW)",
    mms: "Meta MMS-TTS (SW)",
  };

  return (
    <div className="space-y-6 pb-10">
      <header className="rounded-xl border bg-white p-4 sm:p-5 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">🎙️ Text-to-Speech</h1>
            <p className="mt-1 text-sm text-gray-600">
              Clone and synthesize speech with structured parameters and noise-controlled references.
            </p>
          </div>
          <div className="flex items-center gap-2 rounded-full border bg-white px-3 py-1.5 text-xs shadow-sm self-start">
            <span
              className={`inline-block h-2 w-2 rounded-full ${
                backendStatus === "awake"
                  ? "bg-green-500"
                  : backendStatus === "sleeping"
                    ? "bg-amber-500 animate-pulse"
                    : "bg-gray-400 animate-pulse"
              }`}
            />
            {backendStatus === "awake" && <span className="text-green-700 font-medium">Backend awake</span>}
            {backendStatus === "checking" && <span className="text-gray-500">Checking…</span>}
            {backendStatus === "sleeping" && (
              <span className="text-amber-700">Sleeping — first request wakes it</span>
            )}
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
          {[
            { label: "Language", value: language === "en" ? "EN" : "SW" },
            { label: "Engine", value: engineLabel[engine] },
            { label: "Voice ref", value: voiceKey ? "ready" : "none" },
            { label: "Denoise", value: denoiseRef ? "on" : "off" },
          ].map((m) => (
            <div key={m.label} className="rounded-lg border bg-gradient-to-b from-gray-50 to-white px-2 py-2 min-w-0">
              <div className="text-[10px] uppercase tracking-wide text-gray-400">{m.label}</div>
              <div className="text-xs sm:text-sm font-semibold font-mono text-gray-800 tabular-nums truncate" title={String(m.value)}>
                {m.value}
              </div>
            </div>
          ))}
        </div>
      </header>

      <div className="grid grid-cols-3 gap-2 text-center">
        {["1 · Voice", "2 · Engine", "3 · Generate"].map((s, i) => (
          <div key={s} className="rounded-lg border bg-white px-2 py-2 text-[10px] sm:text-xs font-bold uppercase tracking-wide text-gray-500">
            <span className="font-mono text-gray-400 mr-1">[{i + 1}]</span>{s.replace(/^\d · /, "")}
          </div>
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
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
            onSelect={setResult}
            lastReq={lastReq}
            onRegenerated={handleResult}
            onRemove={handleRemoveHistory}
          />
        </div>
      </div>
    </div>
  );
}