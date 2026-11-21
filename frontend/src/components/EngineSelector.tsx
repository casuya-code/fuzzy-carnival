"use client";

import { ENGINE_LABEL, ENGINES_BY_LANGUAGE, type Engine, type Language } from "@/lib/api";

interface Props {
  engine: Engine;
  onChange: (e: Engine) => void;
  language: Language;
  /** Enabled engines reported by /health; when provided, unavailable ones are hidden. */
  availableEngines?: string[] | null;
}

type EngineMeta = {
  id: Engine;
  desc: string;
  bestFor: string;
  usesSample: boolean;
  tier: "online" | "server";
  badge?: string;
};

const ENGINES: EngineMeta[] = [
  // English
  {
    id: "kyutai",
    desc: "Copies your voice sample to read English text.",
    bestFor: "Custom English voiceovers",
    usesSample: true,
    tier: "server",
  },
  {
    id: "afrispeech",
    desc: "Copies your voice sample with an East African English style.",
    bestFor: "English with African accent",
    usesSample: true,
    tier: "server",
  },
  // Swahili
  {
    id: "azure",
    desc: "High-quality, clear Swahili narration (preset voice).",
    bestFor: "Stories, documentaries, and clear Swahili narration",
    usesSample: false,
    tier: "online",
    badge: "Recommended for Swahili",
  },
  {
    id: "msingi",
    desc: "Tries to copy your voice sample for Swahili (runs on the server).",
    bestFor: "Custom Swahili voice when you have a sample",
    usesSample: true,
    tier: "server",
  },
  {
    id: "mms",
    desc: "Simple, reliable Swahili voice (preset). Good fallback when online quota is used.",
    bestFor: "Quick drafts and backup narration",
    usesSample: false,
    tier: "server",
  },
  // Multilingual cloud
  {
    id: "elevenlabs",
    desc: "Expressive voice for English or Swahili. Can use your voice sample for cloning when voice cloning is enabled, or use a preset voice.",
    bestFor: "Expressive narration, character-style reads, and custom cloned voices",
    usesSample: true,
    tier: "online",
  },
];

export default function EngineSelector({ engine, onChange, language, availableEngines }: Props) {
  const allowed = ENGINES_BY_LANGUAGE[language];
  const availableSet = availableEngines ? new Set(availableEngines) : null;
  const filtered = ENGINES.filter(
    (e) => allowed.includes(e.id) && (!availableSet || availableSet.has(e.id))
  );

  return (
    <section className="rounded-xl border bg-white p-4 sm:p-5 shadow-sm space-y-4">
      <div className="flex items-start justify-between gap-3 border-b pb-3">
        <div>
          <h3 className="text-base sm:text-lg font-semibold">Step 2: Choose a voice</h3>
          <p className="mt-1 text-sm text-gray-600">
            Pick how you want your text to sound. {language === "sw" ? "For most Swahili projects, the natural online voice is the best starting point." : "Use a voice-clone option if you added a sample."}
          </p>
        </div>
        <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700 shrink-0">
          {filtered.length} options
        </span>
      </div>

      <div className="space-y-2">
        {filtered.length === 0 ? (
          <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">
            No voice engines are available for this language in the current deployment. Check backend configuration.
          </p>
        ) : (
          filtered.map((e) => {
          const selected = engine === e.id;
          return (
            <button
              key={e.id}
              type="button"
              onClick={() => onChange(e.id)}
              className={`w-full text-left rounded-lg border p-3 sm:p-4 transition ${
                selected
                  ? "border-blue-500 bg-blue-50/60 ring-1 ring-blue-200"
                  : "border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50"
              }`}
            >
              <div className="flex items-start gap-3">
                <div className={`mt-0.5 h-4 w-4 rounded-full border flex items-center justify-center ${selected ? "border-blue-600" : "border-gray-300"}`}>
                  {selected && <div className="h-2 w-2 rounded-full bg-blue-600" />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="font-semibold text-gray-900">{ENGINE_LABEL[e.id]}</div>
                    {e.badge && (
                      <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                        {e.badge}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-sm text-gray-600">{e.desc}</p>
                  <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
                    <span className="rounded-md bg-gray-100 px-2 py-0.5 text-gray-700">Best for: {e.bestFor}</span>
                    <span className={`rounded-md px-2 py-0.5 ${e.usesSample ? "bg-purple-100 text-purple-700" : "bg-slate-100 text-slate-700"}`}>
                      {e.usesSample ? "Uses your voice sample" : "Preset voice"}
                    </span>
                    <span className={`rounded-md px-2 py-0.5 ${e.tier === "online" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
                      {e.tier === "online" ? "Online voice" : "Runs on server"}
                    </span>
                  </div>
                </div>
              </div>
            </button>
          );
          })
        )}
      </div>

      {language === "sw" && (
        <p className="text-xs text-gray-500">
          Tip: If the online Swahili voice is busy or out of quota, the app can automatically switch to the basic Swahili voice for that request.
        </p>
      )}
    </section>
  );
}
