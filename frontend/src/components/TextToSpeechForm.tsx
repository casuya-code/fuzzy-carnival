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
import InfoTip from "@/components/InfoTip";
import ProgressBar from "@/components/ProgressBar";

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
  const submittingRef = useRef(false);

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
    if (!text.trim() || loading || submittingRef.current || text.length > MAX_CHARS) return;
    submittingRef.current = true;
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
      submittingRef.current = false;
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

  const statusHint = elapsed < 4 ? "Starting…" : elapsed < 15 ? "Creating…" : "Still working…";

  return (
    <form onSubmit={submit} className="rounded-xl border bg-white p-4 sm:p-5 shadow-sm space-y-5">
      <div className="border-b pb-3">
        <h3 className="text-base sm:text-lg font-semibold">Step 3: Your text</h3>
        <p className="mt-1 flex items-center gap-1.5 text-sm text-gray-600"><InfoTip text="Paste text, check settings, then create audio." label="Step 3" /></p>
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
            className={`inline-flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2.5 text-sm font-medium transition ${language === "sw" ? "border-blue-500 bg-blue-600 text-white" : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50"}`}
          >
            🇹🇿 Swahili <InfoTip text="Also called Kiswahili." label="Swahili" focusable={false} />
          </button>
        </div>
      </div>

      <div className="rounded-lg border bg-gray-50/60 p-3 sm:p-4 space-y-2 text-sm">
        <div className="flex items-center justify-between gap-2">
          <span className="text-gray-600">Selected voice <InfoTip text="Only use voices and samples you have permission to use." label="Voice permission" /></span>
          <span className="font-medium text-gray-900 text-right">{ENGINE_LABEL[engine]}</span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-gray-600">Your voice sample</span>
          <span className={`inline-flex items-center gap-1.5 font-medium ${needsSample && !hasSample ? "text-amber-700" : "text-gray-900"}`}>
            {hasSample
              ? "Added"
              : needsSample
                ? <>Default voice <InfoTip text="No sample added; this voice uses a default voice." label="Default voice" /></>
                : optionalSampleEngines.includes(engine)
                  ? <>Optional <InfoTip text="Add a sample to clone your voice." label="Optional sample" /></>
                  : <>Not used <InfoTip text="This voice does not use a sample." label="Sample not used" /></>}
          </span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-gray-600">Noise cleanup</span>
          <span className="font-medium text-gray-900">{denoiseRef ? "On" : "Off"}</span>
        </div>
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-gray-600">Speaking pace <InfoTip text="Lower = more deliberate with longer gaps (good for narration). Higher = quicker delivery." label="Speaking pace" /></span>
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
          <p className={`flex items-center gap-1.5 text-xs ${["mms", "azure"].includes(engine) ? "text-gray-500" : "text-amber-700"}`}>
            {["mms", "azure"].includes(engine)
              ? <>Pace applied <InfoTip text="Pace control is applied by this voice." label="Pace applied" /></>
              : <>Pace not applied <InfoTip text="Pace works on Azure Swahili and MMS Swahili." label="Pace not applied" /></>}
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
        <label className="block text-sm font-medium text-gray-700">Project name <InfoTip text="Optional. Used to help name your saved audio files." label="Project name" /></label>
        <input
          type="text"
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder="e.g. Kilimanjaro story"
          className="w-full rounded-lg border border-gray-300 p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
        />
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
          <span>Ctrl+Enter to create <InfoTip text="Use punctuation for natural pauses. You can also add [pause] / (break) for a longer beat, [calm, reflective tone] for delivery, <emphasis>word</emphasis> to stress a word, or scoped tags like <whisper>…</whisper> and <slow>…</slow> — these directions are performed, not read aloud." label="Create shortcut" /></span>
          <span className={overLimit ? "text-red-600 font-semibold" : ""}>{text.length} / {MAX_CHARS}</span>
        </div>
      </div>

      <div className="rounded-lg border bg-gray-50/40 p-3 space-y-2">
        <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer select-none">
          <input type="checkbox" checked={showNorm} onChange={(e) => setShowNorm(e.target.checked)} />
          <span>Preview pronunciation <InfoTip text="Shows how the text will be read; helps with numbers and symbols." label="Pronunciation preview" focusable={false} /></span>
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
        <p className="flex items-center gap-1.5 rounded-md bg-amber-50 border border-amber-200 p-3 text-sm text-amber-800">
          Using a default voice <InfoTip text="No sample added. A 10–15 second sample in Step 1 would copy your voice more closely." label="Default voice" />
        </p>
      )}
      {optionalSampleEngines.includes(engine) && !hasSample && (
        <p className="flex items-center gap-1.5 rounded-md bg-blue-50 border border-blue-200 p-3 text-sm text-blue-800">
          Optional: add a sample <InfoTip text="A 10–15 second sample in Step 1 enables a cloned ElevenLabs voice when cloning is enabled; otherwise a preset voice is used." label="Optional voice sample" />
        </p>
      )}
      {hasSample && !canUseSample && (
        <p className="flex items-center gap-1.5 rounded-md bg-blue-50 border border-blue-200 p-3 text-sm text-blue-800">
          Sample not used <InfoTip text="This voice uses a preset/online voice, so your uploaded sample is ignored for this selection." label="Sample not used" />
        </p>
      )}
      {hasSample && optionalSampleEngines.includes(engine) && (
        <p className="flex items-center gap-1.5 rounded-md bg-blue-50 border border-blue-200 p-3 text-sm text-blue-800">
          Sample added <InfoTip text="If ElevenLabs voice cloning is enabled on the server, this option can use a cloned version of your voice." label="Sample added" />
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

      {loading && <p className="flex items-center gap-1.5 text-sm text-amber-700">{statusHint} <InfoTip text="First runs take longer; long text or a busy server can add time." label="Creation status" /></p>}
      {loading && (
        <div className="pt-1">
          <ProgressBar active={loading} label={`Creating speech… ${elapsed}s`} height={6} />
        </div>
      )}
    </form>
  );
}
