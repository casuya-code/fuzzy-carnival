"use client";

import { useState } from "react";
import InfoTip from "@/components/InfoTip";

type SectionItem = { id: string; title: string };

export default function ManualShell({
  sections,
  children,
}: {
  sections: SectionItem[];
  children: React.ReactNode;
}) {
  const [query, setQuery] = useState("");
  const filtered = sections.filter((s) => s.title.toLowerCase().includes(query.toLowerCase()));

  return (
    <div className="space-y-6">
      <header className="rounded-xl border bg-white p-4 sm:p-6 shadow-sm">
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">📖 Help Guide</h1>
        <p className="mt-2 text-sm sm:text-base text-gray-600 max-w-3xl">
          Instructions for each tool.{" "}
          <InfoTip
            text="Use the menu on the left to open a tool, or jump to a section below."
            label="Navigation help"
          />
        </p>
        <div className="mt-4 max-w-md">
          <label className="mb-1 flex items-center gap-1 text-xs font-medium text-gray-500">
            Find a topic
            <InfoTip text="Type part of a tool name to filter the list." label="Find a topic help" />
          </label>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find a topic…"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
          />
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[240px_1fr]">
        <aside className="lg:sticky lg:top-4 self-start rounded-xl border bg-white p-4 shadow-sm">
          <div className="text-sm font-semibold text-gray-900 mb-2">Jump to</div>
          <nav className="space-y-1">
            {filtered.length === 0 ? (
              <p className="text-sm text-gray-500 px-2 py-1">No matching topics.</p>
            ) : (
              filtered.map((s) => (
                <a key={s.id} href={`#${s.id}`} className="block rounded-lg px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 hover:text-gray-900">
                  {s.title}
                </a>
              ))
            )}
          </nav>
        </aside>

        <div className="space-y-4 sm:space-y-5 min-w-0">
          {children}
        </div>
      </div>
    </div>
  );
}