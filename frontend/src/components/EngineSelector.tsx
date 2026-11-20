"use client";

import { Engine } from "@/lib/api";

interface Props {
  engine: Engine;
  onChange: (e: Engine) => void;
  language: "en" | "sw";
}

const ENGINES: { id: Engine; label: string; desc: string; cloning: boolean }[] = [
  { id: "kyutai", label: "FLUENT (EN)", desc: "Fast English zero-shot cloning (~100M)", cloning: true },
  { id: "afrispeech", label: "AFRICA (EN)", desc: "East African English accent cloning", cloning: true },
  { id: "msingi", label: "Msingi-AI Sauti (SW)", desc: "Authentic Swahili voice cloning (XTTS-v2)", cloning: true },
  { id: "mms", label: "Meta MMS-TTS (SW)", desc: "Fast Swahili fallback (no cloning)", cloning: false },
];

export default function EngineSelector({ engine, onChange, language }: Props) {
  const filtered = ENGINES.filter((e) => {
    if (language === "en") return e.id === "kyutai" || e.id === "afrispeech";
    return e.id === "msingi" || e.id === "mms";
  });

  return (
    <section className="rounded-xl border bg-white p-4 sm:p-5 shadow-sm space-y-4">
      <div className="flex items-center justify-between gap-2 border-b pb-2">
        <h3 className="text-base sm:text-lg font-semibold">② Engine Matrix</h3>
        <span className="rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-mono text-blue-700">
          lang = {language} · n = {filtered.length}
        </span>
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 text-[11px] uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-3 py-2 text-center font-semibold w-12">Sel</th>
              <th className="px-3 py-2 text-left font-semibold">Engine</th>
              <th className="px-3 py-2 text-left font-semibold">Mode</th>
              <th className="px-3 py-2 text-left font-semibold hidden md:table-cell">Description</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {filtered.map((e, i) => {
              const selected = engine === e.id;
              return (
                <tr
                  key={e.id}
                  onClick={() => onChange(e.id)}
                  className={`cursor-pointer transition ${selected ? "bg-blue-50" : i % 2 === 0 ? "bg-white hover:bg-gray-50" : "bg-gray-50/40 hover:bg-gray-50"}`}
                >
                  <td className="px-3 py-3 text-center">
                    <input
                      type="radio"
                      name="engine"
                      value={e.id}
                      checked={selected}
                      onChange={() => onChange(e.id)}
                      className="accent-blue-600"
                    />
                  </td>
                  <td className="px-3 py-3">
                    <div className="font-medium text-gray-800">{e.label}</div>
                    <div className="text-[11px] text-gray-400 font-mono md:hidden mt-0.5">{e.desc}</div>
                  </td>
                  <td className="px-3 py-3">
                    <span
                      className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold font-mono ${
                        e.cloning ? "bg-purple-100 text-purple-700" : "bg-gray-100 text-gray-500"
                      }`}
                    >
                      {e.cloning ? "clone = 1" : "clone = 0"}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-xs text-gray-500 hidden md:table-cell">{e.desc}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="text-[11px] text-gray-400 font-mono">
        active: engine = {engine}
      </div>
    </section>
  );
}