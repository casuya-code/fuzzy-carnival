"use client";

import { useEffect, useRef, useState } from "react";
import { Engine, synthesize, SynthesizeResponse, SynthesizeRequest, normalizePreview } from "@/lib/api";

interface Props {
  language: "en" | "sw";
  setLanguage: (l: "en" | "sw") => void;
  engine: Engine;
  setEngine: (e: Engine) => void;
  voiceKey: string | null;
  denoiseRef: boolean;
  onResult: (res: SynthesizeResponse, req: SynthesizeRequest) => void;
}

const MAX_CHARS = 2000;

export default function TextToSpeechForm({
  language,
  setLanguage,
  engine,
  setEngine,
  voiceKey,
  denoiseRef,
  onResult,
}: Props) {
  const [text, setText] = useState("");
  const [topic, setTopic] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [samples, setSamples] = useState<Record<string, string[]>>({});
  const [elapsed, setElapsed] = useState(0);
  const [showNorm, setShowNorm] = useState(false);
  const [normalized, setNormalized] = useState("");
  const [normLoading, setNormLoading] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    fetch("/sample-prompts.json")
      .then((r) => r.json())
      .then(setSamples)
      .catch(() => setSamples({}));
  }, []);

  useEffect(() => {
    try {
      const t = localStorage.getItem("projectTopic");
      if (t) setTopic(t);
    } catch {}
  }, []);

  useEffect(() => {
    if (language === "en" && (engine === "msingi" || engine === "mms")) setEngine("kyutai");
    if (language === "sw" && (engine === "kyutai" || engine === "afrispeech")) setEngine("mms");
  }, [language]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch normalized preview when toggled or inputs change
  useEffect(() => {
    if (!showNorm || !text.trim()) { setNormalized(""); return; }
    let cancelled = false;
    setNormLoading(true);
    const t = setTimeout(async () => {
      try {
        const n = await normalizePreview(text, language);
        if (!cancelled) setNormalized(n);
      } catch {
        if (!cancelled) setNormalized(text);
      } finally {
        if (!cancelled) setNormLoading(false);
      }
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
  }, [showNorm, text, language]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim() || loading) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError(null);
    setElapsed(0);
    timerRef.current = setInterval(() => setElapsed((s) => s + 1), 1000);
    try {
      const req: SynthesizeRequest = { text, language, engine, voice_r2_key: voiceKey, denoise_ref: denoiseRef, topic: topic.trim() || undefined };
      try { if (topic.trim()) localStorage.setItem("projectTopic", topic.trim()); } catch {}
      const res = await synthesize(req, controller.signal);
      onResult(res, req);
    } catch (err: any) {
      if (err?.name === "AbortError") {
        setError("Generation cancelled.");
      } else {
        const msg = err?.message || "Synthesis failed";
        if (/reference/i.test(msg) && /not found|missing|error/i.test(msg)) {
          setError(`${msg} — your saved reference may be missing (e.g. after restart). Try re-recording or clearing the voice in Step 1.`);
        } else {
          setError(msg);
        }
      }
    } finally {
      if (timerRef.current) clearInterval(timerRef.current);
      abortRef.current = null;
      setLoading(false);
      setElapsed(0);
    }
  };

  const cancel = () => {
    abortRef.current?.abort();
  };

  useEffect(() => {
    return () => { abortRef.current?.abort(); };
  }, []);

  const chips = samples[language] || [];
  const overLimit = text.length > MAX_CHARS;
  const canGenerate = !loading && !!text.trim() && !overLimit;

  return (
    <form onSubmit={submit} className="rounded-xl border bg-white p-4 sm:p-5 shadow-sm space-y-4">
      <div className="flex items-center justify-between gap-2 border-b pb-2">
        <h3 className="text-base sm:text-lg font-semibold">③ Generate Matrix</h3>
        <span className="text-[11px] font-mono text-gray-400">f(text, L, E, ref, dn) → audio</span>
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <table className="min-w-full text-xs sm:text-sm">
          <thead className="bg-gray-50 text-[11px] uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-3 py-2 text-left font-semibold">Param</th>
              <th className="px-3 py-2 text-left font-semibold">Value</th>
              <th className="px-3 py-2 text-left font-semibold hidden sm:table-cell">Detail</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            <tr className="bg-white">
              <td className="px-3 py-2 font-mono text-gray-500">L (lang)</td>
              <td className="px-3 py-2" colSpan={2}>
                <div className="grid grid-cols-2 gap-2 max-w-sm">
                  <button type="button" onClick={() => setLanguage("en")}
                    className={`rounded-md border px-3 py-1.5 text-xs sm:text-sm font-medium transition ${language === "en" ? "border-blue-500 bg-blue-600 text-white" : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"}`}>
                    🇬🇧 English
                  </button>
                  <button type="button" onClick={() => setLanguage("sw")}
                    className={`rounded-md border px-3 py-1.5 text-xs sm:text-sm font-medium transition ${language === "sw" ? "border-blue-500 bg-blue-600 text-white" : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"}`}>
                    🇹🇿 Swahili
                  </button>
                </div>
              </td>
            </tr>
            <tr className="bg-gray-50/40">
              <td className="px-3 py-2 font-mono text-gray-500">E (engine)</td>
              <td className="px-3 py-2 font-mono text-gray-800">{engine}</td>
              <td className="px-3 py-2 text-gray-500 hidden sm:table-cell">Selected in Engine Matrix</td>
            </tr>
            <tr className="bg-white">
              <td className="px-3 py-2 font-mono text-gray-500">ref</td>
              <td className="px-3 py-2 font-mono tabular-nums">{voiceKey ? "1" : "0"}</td>
              <td className="px-3 py-2 text-gray-500 hidden sm:table-cell">{voiceKey ? "Reference voice attached" : "Default voice (no clone ref)"}</td>
            </tr>
            <tr className="bg-gray-50/40">
              <td className="px-3 py-2 font-mono text-gray-500">dn</td>
              <td className="px-3 py-2 font-mono tabular-nums">{denoiseRef ? "1" : "0"}</td>
              <td className="px-3 py-2 text-gray-500 hidden sm:table-cell">Noise reduction on reference</td>
            </tr>
            <tr className="bg-white">
              <td className="px-3 py-2 font-mono text-gray-500">|text|</td>
              <td className={`px-3 py-2 font-mono tabular-nums ${overLimit ? "text-red-600 font-semibold" : "text-gray-800"}`}>{text.length} / {MAX_CHARS}</td>
              <td className="px-3 py-2 text-gray-500 hidden sm:table-cell">{overLimit ? "Over limit" : "Characters"}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {chips.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-[11px] uppercase tracking-wide text-gray-400 font-semibold">Samples</div>
          <div className="flex flex-wrap gap-1.5">
            {chips.map((s, i) => (
              <button key={i} type="button" onClick={() => setText(s)} title={s}
                className="max-w-full truncate rounded-md border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs text-blue-700 transition hover:bg-blue-100">
                {s.length > 42 ? s.slice(0, 42) + "…" : s}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-1.5">
        <label className="block text-[11px] uppercase tracking-wide text-gray-400 font-semibold">Project topic (optional, for R2 file naming)</label>
        <input
          type="text"
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder="e.g. Kilimanjaro story"
          className="w-full rounded-lg border border-gray-300 p-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
        />
      </div>

      <div className="space-y-1.5">
        <label className="block text-[11px] uppercase tracking-wide text-gray-400 font-semibold">Input text</label>
        <div className="relative">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value.slice(0, MAX_CHARS + 100))}
            onKeyDown={(e) => {
              if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                e.preventDefault();
                (e.currentTarget.form as HTMLFormElement | null)?.requestSubmit();
              }
            }}
            rows={5}
            placeholder={language === "en" ? "Enter English text to synthesize..." : "Andika maandishi ya Kiswahili hapa..."}
            className={`w-full rounded-lg border p-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 ${overLimit ? "border-red-400" : "border-gray-300"}`}
          />
        </div>
        <div className="flex items-center justify-between text-[11px] text-gray-400 font-mono">
          <span>Ctrl+Enter = submit</span>
          <span className={overLimit ? "text-red-600 font-semibold" : ""}>{text.length}/{MAX_CHARS}</span>
        </div>
      </div>

      <div className="rounded-lg border bg-gray-50/40 p-3 space-y-2">
        <label className="flex items-center gap-2 text-xs sm:text-sm text-gray-700 cursor-pointer select-none">
          <input type="checkbox" checked={showNorm} onChange={(e) => setShowNorm(e.target.checked)} />
          <span>Preview spoken text <span className="font-mono text-gray-400">(normalize: numbers → words)</span></span>
        </label>
        {showNorm && (
          <div className="rounded-md bg-white border p-2 text-xs text-gray-700 whitespace-pre-wrap font-mono min-h-[2.5rem]">
            {normLoading ? "…" : normalized || "—"}
          </div>
        )}
      </div>

      {error && <p className="rounded-md bg-red-50 border border-red-100 p-2 text-sm text-red-700">{error}</p>}

      {!voiceKey && (engine === "kyutai" || engine === "afrispeech" || engine === "msingi") && (
        <p className="rounded-md bg-amber-50 border border-amber-200 p-2 text-xs text-amber-800">
          ref = 0 — default voice will be used. Add a 10–15s sample in Step 1 for true cloning.
        </p>
      )}

      <p className="text-xs text-gray-500">
        Tip: punctuation provides pause cues (periods = stops, commas = breaths) for natural pacing.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" disabled={!canGenerate}
          className="rounded-md bg-green-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed">
          {loading ? `Generating… ${elapsed}s` : "🔊 Generate Speech"}
        </button>
        {loading && (
          <button type="button" onClick={cancel}
            className="rounded-md border border-gray-300 px-4 py-2.5 text-sm text-gray-600 transition hover:bg-gray-50">
            Cancel
          </button>
        )}
        <span className="text-[11px] font-mono text-gray-400">ready = {canGenerate ? "true" : "false"}</span>
      </div>

      {loading && (
        <p className="text-xs text-amber-600 font-mono">
          {elapsed < 3 ? "state: waking engine…" : elapsed < 15 ? "state: synthesizing (cold start/model load possible)…" : "state: working (long input)…"}
        </p>
      )}

      <p className="text-[11px] text-gray-400">Only clone voices you have permission to use.</p>
    </form>
  );
}