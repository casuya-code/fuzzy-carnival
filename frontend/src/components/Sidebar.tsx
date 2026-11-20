"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

const NAV = [
  { href: "/", label: "Home", icon: "🏠" },
  { href: "/text-to-speech", label: "Text-to-Speech", icon: "🎙️" },
  { href: "/speech-and-background", label: "Speech-and-Background", icon: "🎵" },
  { href: "/trimming-and-zooming", label: "Trimming & Zooming", icon: "✂️" },
  { href: "/animated-captions", label: "Animated Captions", icon: "💬" },
  { href: "/publish-package", label: "Publish Package", icon: "📦" },
  { href: "/history", label: "History", icon: "🗂️" },
  { href: "/instruction-manual", label: "Instruction Manual", icon: "📖" },
];

export default function Sidebar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  return (
    <>
      {/* Mobile top bar */}
      <div className="flex items-center justify-between border-b bg-white px-4 py-3 md:hidden">
        <span className="font-semibold">Bilingual Voice Clone</span>
        <button
          onClick={() => setOpen((o) => !o)}
          className="rounded border px-3 py-1 text-sm"
          aria-label="Toggle menu"
        >
          {open ? "Close" : "Menu"}
        </button>
      </div>

      {/* Overlay for mobile */}
      {open && (
        <div
          className="fixed inset-0 z-30 bg-black/30 md:hidden"
          onClick={() => setOpen(false)}
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-40 w-64 transform border-r bg-white transition-transform md:static md:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex h-full flex-col">
          <div className="border-b px-4 py-4">
            <div className="text-lg font-bold">🎙️ Voice Platform</div>
            <div className="text-xs text-gray-500">English &amp; Swahili</div>
          </div>
          <nav className="flex-1 space-y-1 p-3">
            {NAV.map((item) => {
              const active = isActive(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setOpen(false)}
                  className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition ${
                    active
                      ? "bg-blue-50 text-blue-700"
                      : "text-gray-700 hover:bg-gray-50"
                  }`}
                >
                  <span>{item.icon}</span>
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </nav>
          <div className="border-t p-3 text-[11px] text-gray-400">
            More tools coming soon
          </div>
        </div>
      </aside>
    </>
  );
}