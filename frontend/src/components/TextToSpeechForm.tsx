"use client";

import { useEffect, useRef, useState } from "react";
import {
  DEFAULT_ENGINE,
  ENGINES_BY_LANGUAGE,
  ENGINE_LABEL,
  Engine,
  normalizePreview,
  SynthesizeRequest,
  SynthesizeResponse,
  synthesize,
} from "@/lib/api";

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

const cloningEngines: Engine[] = ["kyutai", "afrispeech", "msingi"];
const optionalSampleEngines: Engine[] = ["elevenlabs"];

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
  const [pace, setPace] = useState(1.0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [samples, setSamples] = useState<Record<string, string[]>>({});
  const [elapsed, setElapsed] = useState(0);
  const [showNorm, setShowNorm] = useState(false);
  const [normalized, setNormalized] = useState("");
  const [normLoading, setNormLoading] = useState(false);
  const [normError, setNormError] = useState<string | null>(null);
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
    if (!ENGINES_BY_LANGUAGE[language].includes(engine)) {
      setEngine(DEFAULT_ENGINE[language]);
    }
  }, [language]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch normalized preview when toggled or inputs change
  useEffect(() => {
    if (!showNorm || !text.trim()) { setNormalized(""); setNormError(null); return; }
    let cancelled = false;
    setNormLoading(true);
    setNormError(null);
    const t = setTimeout(async () => {
      try {
        const n = await normalizePreview(text, language);
        if (!cancelled) setNormalized(n);
      } catch {
        if (!cancelled) {
          setNormalized(text);
          setNormError("Preview unavailable — showing your original text.");
        }
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
      const req: SynthesizeRequest = {
        text,
        language,
        engine,
        voice_r2_key: voiceKey,
        denoise_ref: denoiseRef,
        topic: topic.trim() || undefined,
        speaking_rate: Math.abs(pace - 1) > 0.01 ? pace : undefined,
      };
      try { if (topic.trim()) localStorage.setItem("projectTopic", topic.trim()); } catch {}
      const res = await synthesize(req, controller.signal);
      onResult(res, req);
    } catch (err: any) {
      if (err?.name === "AbortError") {
        setError("Creation was cancelled.");
      } else {
        const msg = err?.message || "Could not create speech. Please try again.";
        if (/reference/i.test(msg) && /not found|missing|error/i.test(msg)) {
          setError(`${msg} Your saved voice sample may be missing. Try uploading or recording it again in Step 1, or clear the sample.`);
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
  const needsSample = cloningEngines.includes(engine);
  const canUseSample = needsSample || optionalSampleEngines.includes(engine);
  const hasSample = !!voiceKey;

  const statusHint =
    elapsed < 4
      ? "Starting..."
      : elapsed < 15
        ? "Creating your audio... this can take a moment, especially the first time."
        : "Still working... longer text or a busy server can take extra time.";

  return (
    <form onSubmit={submit} className="rounded-xl border bg-white p-4 sm:p-5 shadow-sm space-y-5">
      <div className="border-b pb-3">
        <h3 className="text-base sm:text-lg font-semibold">Step 3: Write and create speech</h3>
        <p className="mt-1 text-sm text-gray-600">Type or paste your text, check the settings, then create your audio.</p>
      </div>

      <div className="space-y-2">
        <label className="block text-sm font-medium text-gray-700">Language</label>
        <div className="grid grid-cols-2 gap-2 max-w-md">
          <button
            type="button"
            onClick={() => setLanguage("en")}
            className={`rounded-lg border px-3 py-2.5 text-sm font-medium transition ${language === "en" ? "border-blue-500 bg-blue-600 text-white" : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50"}`}
          >
            🇬🇧 English
          </button>
          <button
            type="button"
            onClick={() => setLanguage("sw")}
            className={`rounded-lg border px-3 py-2.5 text-sm font-medium transition ${language === "sw" ? "border-blue-500 bg-blue-600 text-white" : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50"}`}
          >
            🇹🇿 Swahili (Kiswahili)
          </button>
        </div>
      </div>

      <div className="rounded-lg border bg-gray-50/60 p-3 sm:p-4 space-y-2 text-sm">
        <div className="flex items-center justify-between gap-2">
          <span className="text-gray-600">Selected voice</span>
          <span className="font-medium text-gray-900 text-right">{ENGINE_LABEL[engine]}</span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-gray-600">Your voice sample</span>
          <span className={`font-medium ${needsSample && !hasSample ? "text-amber-700" : "text-gray-900"}`}>
            {hasSample
              ? "Added"
              : needsSample
                ? "Not added (will use a default voice)"
                : optionalSampleEngines.includes(engine)
                  ? "Optional (add one to clone your voice)"
                  : "Not needed for this voice"}
          </span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-gray-600">Noise cleanup</span>
          <span className="font-medium text-gray-900">{denoiseRef ? "On" : "Off"}</span>
        </div>
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-gray-600">Speaking pace</span>
            <span className="font-medium text-gray-900">
              {pace < 0.95 ? "Slower" : pace > 1.05 ? "Faster" : "Natural"}
            </span>
          </div>
          <input
            type="range"
            min={0.7}
            max={1.4}
            step={0.05}
            value={pace}
            onChange={(e) => setPace(parseFloat(e.target.value))}
            className="w-full accent-blue-600"
            aria-label="Speaking pace"
          />
          <p className="text-xs text-gray-500">
            Lower = more deliberate with longer gaps (good for narration). Higher = quicker delivery.
          </p>
          <p className={`text-xs ${["mms", "azure"].includes(engine) ? "text-gray-500" : "text-amber-700"}`}>
            {["mms", "azure"].includes(engine)
              ? "Pace control is applied by this voice."
              : "This voice keeps its natural pace right now; pace control applies to Azure Swahili and Basic Swahili (MMS)."}
          </p>
        </div>
      </div>

      {chips.length > 0 && (
        <div className="space-y-2">
          <div className="text-sm font-medium text-gray-700">Try a sample text</div>
          <div className="grid w-full grid-cols-1 gap-2 sm:grid-cols-2">
            {chips.map((s, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setText(s)}
                title={s}
                className="w-full min-w-0 truncate rounded-full border border-blue-200 bg-blue-50 px-3 py-2 text-left text-xs sm:text-sm text-blue-700 transition hover:bg-blue-100"
              >
                {s.length > 48 ? s.slice(0, 48) + "…" : s}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-2">
        <label className="block text-sm font-medium text-gray-700">Project name (optional)</label>
        <input
          type="text"
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder="e.g. Kilimanjaro story"
          className="w-full rounded-lg border border-gray-300 p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
        />
        <p className="text-xs text-gray-500">Used to help name your saved audio files.</p>
      </div>

      <div className="space-y-2">
        <label className="block text-sm font-medium text-gray-700">Your text</label>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value.slice(0, MAX_CHARS + 100))}
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
              e.preventDefault();
              (e.currentTarget.form as HTMLFormElement | null)?.requestSubmit();
            }
          }}
          rows={6}
          placeholder={language === "en" ? "Type or paste the text you want to hear..." : "Andika au bandika maandishi unayotaka yasomwe..."}
          className={`w-full rounded-lg border p-3 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-blue-200 ${overLimit ? "border-red-400" : "border-gray-300"}`}
        />
        <div className="flex items-center justify-between text-xs text-gray-500">
          <span>Tip: Press Ctrl+Enter to create speech. Use punctuation for natural pauses.</span>
          <span className={overLimit ? "text-red-600 font-semibold" : ""}>{text.length} / {MAX_CHARS}</span>
        </div>
      </div>

      <div className="rounded-lg border bg-gray-50/40 p-3 space-y-2">
        <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer select-none">
          <input type="checkbox" checked={showNorm} onChange={(e) => setShowNorm(e.target.checked)} />
          <span>Show how the text will be read (helps with numbers and symbols)</span>
        </label>
        {showNorm && (
          <div className="space-y-2">
            <div className="rounded-md bg-white border p-3 text-sm text-gray-700 whitespace-pre-wrap min-h-[2.75rem]">
              {normLoading ? "Preparing preview..." : normalized || "Type some text above to see a preview."}
            </div>
            {normError && (
              <p className="rounded-md bg-amber-50 border border-amber-200 p-2 text-xs text-amber-800">
                <strong>Note:</strong> {normError}
              </p>
            )}
          </div>
        )}
      </div>

      {error && <p className="rounded-md bg-red-50 border border-red-100 p-3 text-sm text-red-700">{error}</p>}

      {needsSample && !hasSample && (
        <p className="rounded-md bg-amber-50 border border-amber-200 p-3 text-sm text-amber-800">
          You haven&apos;t added a voice sample. This voice can still work with a default voice, but adding a 10–15 second sample in Step 1 will copy your voice more closely.
        </p>
      )}
      {optionalSampleEngines.includes(engine) && !hasSample && (
        <p className="rounded-md bg-blue-50 border border-blue-200 p-3 text-sm text-blue-800">
          You can add a 10–15 second voice sample in Step 1 to create a cloned ElevenLabs voice (when voice cloning is enabled). Without a sample, this option uses a preset voice.
        </p>
      )}
      {hasSample && !canUseSample && (
        <p className="rounded-md bg-blue-50 border border-blue-200 p-3 text-sm text-blue-800">
          This voice uses a preset/online voice, so your uploaded sample won&apos;t be used for this selection.
        </p>
      )}
      {hasSample && optionalSampleEngines.includes(engine) && (
        <p className="rounded-md bg-blue-50 border border-blue-200 p-3 text-sm text-blue-800">
          Your voice sample is added. If ElevenLabs voice cloning is enabled on the server, this option can use a cloned version of your voice.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2 pt-1">
        <button
          type="submit"
          disabled={!canGenerate}
          className="rounded-lg bg-green-600 px-5 py-2.5 text-sm sm:text-base font-semibold text-white transition hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? `Creating speech… ${elapsed}s` : "Create speech"}
        </button>
        {loading && (
          <button
            type="button"
            onClick={cancel}
            className="rounded-lg border border-gray-300 px-4 py-2.5 text-sm text-gray-700 transition hover:bg-gray-50"
          >
            Stop
          </button>
        )}
      </div>

      {loading && <p className="text-sm text-amber-700">{statusHint}</p>}

      <p className="text-xs text-gray-500">Only use voices and samples you have permission to use.</p>
    </form>
  );
}
